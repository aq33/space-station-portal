"""Ekstraktor drzewa typów z kodu DM.

Czyta plik .dme, przechodzi po wszystkich #include i wyciąga typy atomów
(/area, /turf, /obj, /mob) razem ze zmiennymi potrzebnymi do wyświetlania:
icon, icon_state, name, dir, layer, plane, przesunięcia pikseli itd.

To nie jest pełny kompilator DM. Parser rozumie bloki z wcięciami i klamrami,
#define (także makra z argumentami wywołane jako instrukcja), #if/#ifdef,
a ciała procedur pomija. Na potrzeby edytora map to wystarcza.

Kopia z ss13-edytor, z dodatkowymi zmiennymi sprite'ów w ręce i na postaci.

Użycie: python ekstraktor.py <ścieżka do .dme> <plik wyjściowy .json>
"""

import json
import os
import re
import sys
import time

# Zmienne, które edytor wykorzystuje. Reszta jest pomijana, żeby JSON był mały.
ZMIENNE = {
    "icon", "icon_state", "name", "desc", "dir", "layer", "plane",
    "pixel_x", "pixel_y", "pixel_w", "pixel_z", "color", "alpha",
    "density", "opacity", "invisibility", "smooth", "canSmoothWith",
    "abstract_type", "parent_type", "base_icon_state", "smoothing_flags",
    "smoothing_groups", "legacy_smooth", "fulltile", "anchored",
    "texture", "texture_state", "requires_power", "always_unpowered",
    "cable_color", "omni", "multiz",
    "lefthand_file", "righthand_file", "inhand_icon_state", "item_state",
    "worn_icon", "worn_icon_state", "post_init_icon_state", "greyscale_config",
    "icon_preview", "icon_state_preview", "wear_image_icon", "wear_state",
    "inhand_image_icon", "mob_overlay_icon", "alternate_worn_icon",
}

KORZENIE = ("/area", "/turf", "/obj", "/mob")

# Stałe wbudowane w BYOND, potrzebne do wyliczania wartości.
WBUDOWANE = {
    "NORTH": "1", "SOUTH": "2", "EAST": "4", "WEST": "8",
    "NORTHEAST": "5", "NORTHWEST": "9", "SOUTHEAST": "6", "SOUTHWEST": "10",
    "UP": "16", "DOWN": "32",
    "TRUE": "1", "FALSE": "0", "null": "null",
    "FLOAT_LAYER": "-1", "AREA_LAYER": "1", "TURF_LAYER": "2",
    "OBJ_LAYER": "3", "MOB_LAYER": "4", "FLY_LAYER": "5",
    "EFFECTS_LAYER": "5000", "TOPDOWN_LAYER": "10000",
    "BACKGROUND_LAYER": "20000", "FLOAT_PLANE": "-32767",
    "DM_VERSION": "516", "DM_BUILD": "1660", "CBT": "1",
    "INFINITY": "1e31",
}


# ---------------------------------------------------------------------------
# Usuwanie komentarzy (z pominięciem tekstu w napisach)

def _pomin_napis(t, i, wielolinijkowy):
    """i wskazuje pierwszy znak po otwarciu napisu. Zwraca indeks za końcem."""
    n = len(t)
    while i < n:
        c = t[i]
        if c == "\\":
            i += 2
            continue
        if c == "[":
            i = _pomin_wyrazenie(t, i + 1)
            continue
        if c == '"':
            if wielolinijkowy:
                if i + 1 < n and t[i + 1] == "}":
                    return i + 2
            else:
                return i + 1
        if c == "\n" and not wielolinijkowy:
            return i
        i += 1
    return n


def _pomin_wyrazenie(t, i):
    """Wyrażenie [...] osadzone w napisie. Zwraca indeks za ']'."""
    n = len(t)
    glebokosc = 1
    while i < n:
        c = t[i]
        if c == '"':
            i = _pomin_napis(t, i + 1, False)
            continue
        if c == "{" and i + 1 < n and t[i + 1] == '"':
            i = _pomin_napis(t, i + 2, True)
            continue
        if c == "[":
            glebokosc += 1
        elif c == "]":
            glebokosc -= 1
            if glebokosc == 0:
                return i + 1
        elif c == "\n":
            return i
        i += 1
    return n


_SPECJALNE = re.compile(r'"|\{"|\'|//|/\*')


def usun_komentarze(t):
    wynik = []
    i = 0
    n = len(t)
    while i < n:
        m = _SPECJALNE.search(t, i)
        if not m:
            wynik.append(t[i:])
            break
        s = m.start()
        wynik.append(t[i:s])
        tok = m.group()
        if tok == '"':
            e = _pomin_napis(t, s + 1, False)
            wynik.append(t[s:e])
            i = e
        elif tok == '{"':
            e = _pomin_napis(t, s + 2, True)
            # Napis wielolinijkowy zamieniam na jednolinijkowy, żeby nie psuć wcięć.
            wynik.append(t[s:e].replace("\n", " "))
            i = e
        elif tok == "'":
            e = t.find("'", s + 1)
            nl = t.find("\n", s + 1)
            if e == -1 or (nl != -1 and nl < e):
                e = s
            wynik.append(t[s:e + 1])
            i = e + 1
        elif tok == "//":
            e = t.find("\n", s)
            # Komentarz kończący się '\' nie łączy linii – zostawiam sam koniec linii.
            i = n if e == -1 else e
        else:  # /* ... */ (BYOND pozwala je zagnieżdżać)
            glebokosc = 1
            j = s + 2
            while j < n and glebokosc:
                if t.startswith("/*", j):
                    glebokosc += 1
                    j += 2
                elif t.startswith("*/", j):
                    glebokosc -= 1
                    j += 2
                else:
                    j += 1
            wynik.append("\n" * t.count("\n", s, j))
            i = j
    return "".join(wynik)


# ---------------------------------------------------------------------------
# Preprocesor

_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


class Preprocesor:
    def __init__(self):
        self.proste = dict(WBUDOWANE)   # NAZWA -> tekst
        self.funkcyjne = {}             # NAZWA -> (argumenty, treść)

    def zdefiniowane(self, nazwa):
        return nazwa in self.proste or nazwa in self.funkcyjne

    def define(self, reszta):
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)(\(([^)]*)\))?\s*(.*)$", reszta, re.S)
        if not m:
            return
        nazwa, _, argumenty, tresc = m.groups()
        tresc = tresc.strip()
        if m.group(2) is not None:
            self.funkcyjne[nazwa] = ([a.strip() for a in argumenty.split(",") if a.strip()], tresc)
            self.proste.pop(nazwa, None)
        else:
            self.proste[nazwa] = tresc
            self.funkcyjne.pop(nazwa, None)

    def undef(self, nazwa):
        self.proste.pop(nazwa, None)
        self.funkcyjne.pop(nazwa, None)

    def rozwin_proste(self, tekst, glebokosc=0):
        """Podmienia identyfikatory na wartości #define (poza napisami)."""
        if glebokosc > 20:
            return tekst

        def podmien(m):
            nazwa = m.group()
            if nazwa in self.proste:
                return "(" + self.rozwin_proste(self.proste[nazwa], glebokosc + 1) + ")" \
                    if re.search(r"[-+*/]", self.proste[nazwa]) else \
                    self.rozwin_proste(self.proste[nazwa], glebokosc + 1)
            return nazwa

        czesci = re.split(r'("(?:\\.|[^"\\])*"|\'[^\']*\')', tekst)
        for k in range(0, len(czesci), 2):
            czesci[k] = _IDENT.sub(podmien, czesci[k])
        return "".join(czesci)

    def warunek(self, wyrazenie):
        w = re.sub(r"defined\s*\(\s*(\w+)\s*\)", lambda m: "1" if self.zdefiniowane(m.group(1)) else "0", wyrazenie)
        w = self.rozwin_proste(w)
        w = w.replace("&&", " and ").replace("||", " or ")
        w = re.sub(r"!(?!=)", " not ", w)
        w = re.sub(r"[A-Za-z_]\w*", lambda m: m.group() if m.group() in ("and", "or", "not") else "0", w)
        try:
            return bool(eval(w, {"__builtins__": {}}, {}))
        except Exception:
            return True

    def _argumenty(self, tekst, i):
        """i wskazuje znak za '('. Zwraca (lista argumentów, indeks za ')')."""
        glebokosc = 1
        argumenty = []
        biezacy = []
        while i < len(tekst):
            c = tekst[i]
            if c == '"':
                e = _pomin_napis(tekst, i + 1, False)
                biezacy.append(tekst[i:e])
                i = e
                continue
            if c in "([":
                glebokosc += 1
            elif c in ")]":
                glebokosc -= 1
                if glebokosc == 0:
                    argumenty.append("".join(biezacy).strip())
                    return argumenty, i + 1
            elif c == "," and glebokosc == 1:
                argumenty.append("".join(biezacy).strip())
                biezacy = []
                i += 1
                continue
            biezacy.append(c)
            i += 1
        return None, i

    def _rozwin_jedno(self, nazwa, argumenty):
        nazwy, tresc = self.funkcyjne[nazwa]
        if argumenty == [""] and not nazwy:
            argumenty = []
        mapa = dict(zip(nazwy, argumenty))
        if nazwy and nazwy[-1] == "...":
            mapa["__VA_ARGS__"] = ", ".join(argumenty[len(nazwy) - 1:])
        tresc = re.sub(r"(?<!#)#(?!#)\s*([A-Za-z_]\w*)",
                       lambda mm: '"%s"' % mapa[mm.group(1)] if mm.group(1) in mapa else mm.group(), tresc)
        tresc = _IDENT.sub(lambda mm: mapa.get(mm.group(), mm.group()), tresc)
        return re.sub(r"\s*##\s*", "", tresc)

    _WYWOLANIE = re.compile(r'"|\b([A-Za-z_]\w*)\s*\(')

    def wywolanie(self, tekst, glebokosc=0):
        """Rozwija wszystkie wywołania makr funkcyjnych w tekście.
        Zwraca None, jeśli nie było żadnego."""
        zmiana = False
        wynik = []
        i = 0
        while True:
            m = self._WYWOLANIE.search(tekst, i)
            if not m:
                wynik.append(tekst[i:])
                break
            if m.group() == '"':
                e = _pomin_napis(tekst, m.end(), False)
                wynik.append(tekst[i:e])
                i = e
                continue
            nazwa = m.group(1)
            if nazwa not in self.funkcyjne:
                wynik.append(tekst[i:m.end()])
                i = m.end()
                continue
            argumenty, koniec = self._argumenty(tekst, m.end())
            if argumenty is None:
                wynik.append(tekst[i:])
                break
            wynik.append(tekst[i:m.start()])
            wynik.append(" " + self._rozwin_jedno(nazwa, argumenty) + " ")
            i = koniec
            zmiana = True
        if not zmiana:
            return None
        tekst = "".join(wynik)
        if glebokosc < 8:
            dalej = self.wywolanie(tekst, glebokosc + 1)
            if dalej is not None:
                return dalej
        return tekst


def przetworz_dyrektywy(tekst, pp, plik, dolacz, odroczone):
    """Obsługuje linie #... i zwraca kod bez nich. dolacz(plik) wczytuje #include.
    #undef trafia do listy odroczone – wykonuje się po wczytaniu kodu pliku,
    bo kod parsuję dopiero po dyrektywach, a makra bywają kasowane na końcu pliku."""
    linie = tekst.split("\n")
    wynik = []
    stos = []  # (aktywny, czy_juz_byla_prawdziwa_galaz)
    i = 0
    while i < len(linie):
        linia = linie[i]
        # Łączenie linii zakończonych '\'.
        while linia.rstrip().endswith("\\") and i + 1 < len(linie):
            linia = linia.rstrip()[:-1] + " " + linie[i + 1].strip()
            i += 1
            wynik.append("")
        i += 1
        s = linia.strip()
        aktywny = all(a for a, _ in stos)
        if not s.startswith("#"):
            wynik.append(linia if aktywny else "")
            continue
        wynik.append("")
        m = re.match(r"#\s*(\w+)\s*(.*)$", s)
        if not m:
            continue
        dyr, reszta = m.groups()
        if dyr in ("if", "ifdef", "ifndef"):
            if not aktywny:
                stos.append((False, True))
                continue
            if dyr == "ifdef":
                v = pp.zdefiniowane(reszta.split()[0]) if reszta else False
            elif dyr == "ifndef":
                v = not pp.zdefiniowane(reszta.split()[0]) if reszta else True
            else:
                v = pp.warunek(reszta)
            stos.append((v, v))
        elif dyr == "elif":
            if stos:
                _, byla = stos.pop()
                rodzic = all(a for a, _ in stos)
                v = rodzic and not byla and pp.warunek(reszta)
                stos.append((v, byla or v))
        elif dyr == "else":
            if stos:
                _, byla = stos.pop()
                stos.append((not byla, True))
        elif dyr == "endif":
            if stos:
                stos.pop()
        elif not aktywny:
            continue
        elif dyr == "define":
            pp.define(reszta)
        elif dyr == "undef":
            odroczone.append(reszta.strip())
        elif dyr == "include":
            mm = re.match(r'"([^"]+)"', reszta)
            if mm:
                dolacz(os.path.join(os.path.dirname(plik), mm.group(1).replace("\\", os.sep)))
    return "\n".join(wynik)


# ---------------------------------------------------------------------------
# Podział na instrukcje z głębokością zagnieżdżenia

def instrukcje(tekst):
    """Generuje (glebokosc, tekst_instrukcji). Rozumie wcięcia i bloki { ; }."""
    wynik = []
    stos_wciec = [0]
    stos_klamer = []   # głębokość nagłówka bloku w klamrach
    biezacy = []
    glebokosc_biezaca = 0
    nawiasy = 0
    poczatek_linii = True
    i = 0
    n = len(tekst)

    def wyslij():
        s = "".join(biezacy).strip()
        if s:
            wynik.append((glebokosc_biezaca, s))
        biezacy.clear()

    while i < n:
        c = tekst[i]
        if poczatek_linii:
            j = i
            szer = 0
            while j < n and tekst[j] in " \t":
                szer += 4 if tekst[j] == "\t" else 1
                j += 1
            if j < n and tekst[j] == "\n":
                i = j + 1
                continue
            poczatek_linii = False
            i = j
            if not stos_klamer and nawiasy == 0 and not biezacy:
                if szer > stos_wciec[-1]:
                    stos_wciec.append(szer)
                else:
                    while len(stos_wciec) > 1 and szer < stos_wciec[-1]:
                        stos_wciec.pop()
                    if szer > stos_wciec[-1]:
                        stos_wciec.append(szer)
                glebokosc_biezaca = len(stos_wciec) - 1
            continue
        if c == '"':
            e = _pomin_napis(tekst, i + 1, False)
            biezacy.append(tekst[i:e])
            i = e
            continue
        if c == "{" and i + 1 < n and tekst[i + 1] == '"':
            e = _pomin_napis(tekst, i + 2, True)
            biezacy.append(tekst[i:e])
            i = e
            continue
        if c == "'":
            e = tekst.find("'", i + 1)
            if e == -1:
                e = i
            biezacy.append(tekst[i:e + 1])
            i = e + 1
            continue
        if c in "([":
            nawiasy += 1
        elif c in ")]":
            nawiasy = max(0, nawiasy - 1)
        elif c == "\n":
            if nawiasy == 0:
                wyslij()
                poczatek_linii = True
                if stos_klamer:
                    glebokosc_biezaca = stos_klamer[-1] + 1
            else:
                biezacy.append(" ")
            i += 1
            continue
        elif nawiasy == 0 and c == ";":
            wyslij()
            i += 1
            continue
        elif nawiasy == 0 and c == "{":
            wyslij()
            stos_klamer.append(glebokosc_biezaca)
            glebokosc_biezaca += 1
            i += 1
            continue
        elif nawiasy == 0 and c == "}":
            wyslij()
            if stos_klamer:
                glebokosc_biezaca = stos_klamer.pop()
                if stos_klamer:
                    glebokosc_biezaca = stos_klamer[-1] + 1
                else:
                    glebokosc_biezaca = len(stos_wciec) - 1
            i += 1
            continue
        biezacy.append(c)
        i += 1
    wyslij()
    return wynik


# ---------------------------------------------------------------------------
# Budowa drzewa typów

def _rozdziel_przypisanie(s):
    """Zwraca (lewa, prawa) dla 'a = b' na najwyższym poziomie albo None."""
    glebokosc = 0
    i = 0
    while i < len(s):
        c = s[i]
        if c == '"':
            i = _pomin_napis(s, i + 1, False)
            continue
        if c in "([":
            glebokosc += 1
        elif c in ")]":
            glebokosc -= 1
        elif c == "=" and glebokosc == 0:
            poprz = s[i - 1] if i else ""
            nast = s[i + 1] if i + 1 < len(s) else ""
            if poprz not in "=!<>+-*/|&^%~" and nast != "=":
                return s[:i].strip(), s[i + 1:].strip()
            return None
        i += 1
    return None


class Drzewo:
    def __init__(self, pp):
        self.pp = pp
        self.typy = {}  # ścieżka -> {"v": {zmienna: wartość}}

    def typ(self, sciezka):
        t = self.typy.get(sciezka)
        if t is None:
            t = self.typy[sciezka] = {}
            rodzic = sciezka.rsplit("/", 1)[0]
            if rodzic and rodzic not in self.typy:
                self.typ(rodzic)
        return t

    def ustaw(self, sciezka, nazwa, wartosc):
        if nazwa not in ZMIENNE:
            # Typ i tak powinien istnieć.
            if sciezka:
                self.typ(sciezka)
            return
        self.typ(sciezka)[nazwa] = wylicz(wartosc, self.pp)

    def wczytaj(self, tekst):
        kontekst = []      # (glebokosc, sciezka, tryb) tryb: "typ" | "var" | "pomin"
        for glebokosc, s in instrukcje(tekst):
            self.krok(glebokosc, s, kontekst)

    def krok(self, glebokosc, s, kontekst, poziom=0):
        while kontekst and kontekst[-1][0] >= glebokosc:
            kontekst.pop()
        if kontekst and kontekst[-1][2] == "pomin":
            return
        rodzic = kontekst[-1][1] if kontekst else ""
        tryb_rodzica = kontekst[-1][2] if kontekst else "typ"
        rozwiniecie = self.pp.wywolanie(s) if poziom < 5 else None
        if rozwiniecie is not None:
            for g, s2 in instrukcje(rozwiniecie):
                self.krok(glebokosc + g, s2, kontekst, poziom + 1)
            return
        self.instrukcja(glebokosc, s, rodzic, tryb_rodzica, kontekst)

    def instrukcja(self, glebokosc, s, rodzic, tryb_rodzica, kontekst):
        if tryb_rodzica == "var":
            p = _rozdziel_przypisanie(s)
            lewa = p[0] if p else s
            nazwa = lewa.split("/")[-1].strip()
            if p:
                self.ustaw(rodzic, nazwa, p[1])
            kontekst.append((glebokosc, rodzic, "var"))
            return
        p = _rozdziel_przypisanie(s)
        if p:
            lewa, prawa = p
            if "(" in lewa:
                kontekst.append((glebokosc, rodzic, "pomin"))
                return
            seg = [x for x in lewa.strip("/").split("/") if x]
            if not seg:
                return
            if "var" in seg:
                k = seg.index("var")
                wlasciciel = seg[:k]
            else:
                wlasciciel = seg[:-1]
            nazwa = seg[-1].strip()
            sciezka = self._sciezka(lewa.startswith("/"), rodzic, wlasciciel)
            if sciezka is not None:
                self.ustaw(sciezka, nazwa, prawa)
            return
        # Nagłówek ścieżki, procedury albo bloku var/proc.
        if "(" in s:
            glowa = s[:s.index("(")]
            seg = [x for x in glowa.strip("/").split("/") if x]
            wlasciciel = [x for x in seg[:-1] if x not in ("proc", "verb")]
            if "proc" in seg:
                wlasciciel = seg[:seg.index("proc")]
            elif "verb" in seg:
                wlasciciel = seg[:seg.index("verb")]
            sciezka = self._sciezka(glowa.startswith("/"), rodzic, wlasciciel)
            if sciezka:
                self.typ(sciezka)
            kontekst.append((glebokosc, rodzic, "pomin"))
            return
        if not re.match(r"^/?[A-Za-z_][\w/]*$", s):
            kontekst.append((glebokosc, rodzic, "pomin"))
            return
        seg = [x for x in s.strip("/").split("/") if x]
        if "proc" in seg or "verb" in seg:
            kontekst.append((glebokosc, rodzic, "pomin"))
            return
        if "var" in seg:
            k = seg.index("var")
            sciezka = self._sciezka(s.startswith("/"), rodzic, seg[:k])
            if k < len(seg) - 1:
                # 'var/foo' bez wartości – tylko deklaracja.
                return
            kontekst.append((glebokosc, sciezka or "", "var"))
            return
        sciezka = self._sciezka(s.startswith("/"), rodzic, seg)
        if sciezka:
            self.typ(sciezka)
        kontekst.append((glebokosc, sciezka or "", "typ"))

    @staticmethod
    def _sciezka(absolutna, rodzic, segmenty):
        if absolutna or not rodzic:
            baza = ""
        else:
            baza = rodzic
        sciezka = baza + "".join("/" + x for x in segmenty)
        return sciezka


_LICZBA = re.compile(r"^[-+*/%() .0-9e]+$")


def wylicz(wartosc, pp):
    """Zamienia tekst wartości z DM na wartość JSON (napis, liczbę, null)."""
    w = wartosc.strip()
    if not w:
        return None
    if w.startswith('"') and w.endswith('"') and len(w) >= 2 and _pomin_napis(w, 1, False) == len(w):
        return w[1:-1].replace('\\"', '"')
    if w.startswith('{"') and w.endswith('"}'):
        return w[2:-2]
    if w.startswith("'") and w.endswith("'"):
        return {"plik": w[1:-1]}
    if w.startswith("/"):
        return {"typ": w}
    w2 = pp.rozwin_proste(w).strip()
    m = re.fullmatch(r"\(?\s*rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\s*\)?", w2)
    if m:
        return "#%02x%02x%02x" % tuple(min(255, int(x)) for x in m.groups())
    if '"' in w2 and "+" in w2:
        czesci = [x.strip().strip("()").strip() for x in re.split(r'\+(?=(?:[^"]*"[^"]*")*[^"]*$)', w2)]
        if all(len(x) >= 2 and x[0] == x[-1] == '"' for x in czesci):
            return "".join(x[1:-1] for x in czesci)
    if w2.startswith('"') and w2.endswith('"'):
        return w2[1:-1]
    if w2.startswith("'") and w2.endswith("'"):
        return {"plik": w2[1:-1]}
    if w2 == "null":
        return None
    if w2.startswith("list("):
        return {"lista": [x.strip() for x in w2[5:-1].split(",") if x.strip()]}
    w3 = w2.replace("|", " | ").replace("&", " & ")
    if _LICZBA.match(w2) or re.match(r"^[-+*/%() .0-9e|&<>~]+$", w2):
        try:
            v = eval(w3, {"__builtins__": {}}, {})
            if isinstance(v, float) and v.is_integer() and abs(v) < 1e15:
                v = int(v)
            return v
        except Exception:
            pass
    return {"wyr": w}


# ---------------------------------------------------------------------------
# Statystyki z map: ile razy używany jest typ i jak mapperzy wieszają go na ścianie

_WPIS_ZE_ZMIENNYMI = re.compile(r"^(/[\w/]+)\{\n((?:\t[^\n]*\n)*?)\t\}", re.M)
_ZMIENNA_WPISU = re.compile(r"^\t(\w+) = (.*?);?$", re.M)
_KLUCZE_MONTAZU = ("dir", "pixel_x", "pixel_y")


def _kierunek_montazu(zm):
    """Po której stronie kafelka wisi obiekt (1/2/4/8) albo None."""
    try:
        px = float(zm.get("pixel_x", 0))
        py = float(zm.get("pixel_y", 0))
    except ValueError:
        return None
    if max(abs(px), abs(py)) < 16:
        return None
    if abs(py) >= abs(px):
        return 1 if py > 0 else 2
    return 4 if px > 0 else 8


def statystyki_map(teksty):
    """Zwraca (uzycie, montaz). montaz[typ][kierunek] = najczęstsze [[zmienna, wartość], ...]."""
    uzycie = {}
    liczniki = {}
    for t in teksty:
        for m in re.finditer(r"^(/[\w/]+)", t, re.M):
            uzycie[m.group(1)] = uzycie.get(m.group(1), 0) + 1
        for m in _WPIS_ZE_ZMIENNYMI.finditer(t):
            zm = {k: v.strip() for k, v in _ZMIENNA_WPISU.findall(m.group(2)) if k in _KLUCZE_MONTAZU}
            d = _kierunek_montazu(zm)
            if d is None:
                continue
            podpis = json.dumps(sorted(zm.items()))
            klucz = (m.group(1), d)
            liczniki.setdefault(klucz, {})
            liczniki[klucz][podpis] = liczniki[klucz].get(podpis, 0) + 1
    montaz = {}
    for (typ, d), warianty in liczniki.items():
        # przy remisie wygrywa podpis pierwszy alfabetycznie – tak samo w ekstraktor.js
        najlepszy = sorted(warianty.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        montaz.setdefault(typ, {})[str(d)] = json.loads(najlepszy)
    return uzycie, montaz


def ekstrahuj(dme):
    pp = Preprocesor()
    drzewo = Drzewo(pp)
    katalog = os.path.dirname(os.path.abspath(dme))
    odwiedzone = set()
    pliki = []

    def dolacz(sciezka):
        sciezka = os.path.normpath(sciezka)
        klucz = sciezka.lower()
        if klucz in odwiedzone:
            return
        odwiedzone.add(klucz)
        rozsz = os.path.splitext(sciezka)[1].lower()
        if rozsz not in (".dm", ".dme"):
            return
        try:
            with open(sciezka, encoding="utf-8", errors="replace") as f:
                tekst = f.read()
        except OSError:
            return
        pliki.append(sciezka)
        tekst = usun_komentarze(tekst.replace("\r\n", "\n").replace("\r", "\n"))
        odroczone = []
        tekst = przetworz_dyrektywy(tekst, pp, sciezka, dolacz, odroczone)
        if rozsz == ".dm":
            drzewo.wczytaj(tekst)
        for nazwa in odroczone:
            pp.undef(nazwa)

    dolacz(os.path.abspath(dme))

    # Tylko atomy, z rodzicem wyliczonym ze ścieżki (albo parent_type).
    wynik = {}
    for sciezka, zm in drzewo.typy.items():
        if not sciezka.startswith(KORZENIE):
            continue
        if not any(sciezka == k or sciezka.startswith(k + "/") for k in KORZENIE):
            continue
        wpis = {k: v for k, v in zm.items() if k != "parent_type"}
        pt = zm.get("parent_type")
        if isinstance(pt, dict) and "typ" in pt:
            wpis["^"] = pt["typ"]
        wynik[sciezka] = wpis
    for k in KORZENIE:
        wynik.setdefault(k, {})
    return {"typy": wynik, "pliki": len(pliki), "katalog": katalog}


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    t0 = time.time()
    dane = ekstrahuj(sys.argv[1])
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        json.dump({"typy": dane["typy"]}, f, ensure_ascii=False, separators=(",", ":"))
    print("Plików: %d, typów atomów: %d, czas: %.1f s" % (dane["pliki"], len(dane["typy"]), time.time() - t0))


if __name__ == "__main__":
    main()
