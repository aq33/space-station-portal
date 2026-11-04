"""Indeks sprite'ów repozytorium SS13 (BYOND).

Czyta kod DM ekstraktorem, rozwija dziedziczenie zmiennych i sprawdza w plikach
.dmi, czy stan ikony naprawdę istnieje. Wynik to lista atomów z nazwą, opisem
i sprite'ami (główny, w lewej i prawej ręce, na postaci).
"""

import os
import re
import struct
import zlib

import ekstraktor
import obraz

PNG_SYGNATURA = bytes([137, 80, 78, 71, 13, 10, 26, 10])
KIERUNKI_STANU = re.compile(r'^\s*(\w+)\s*=\s*(.*)$')


class OpisDmi(dict):
    """Stany pliku .dmi: nazwa -> (numer pierwszej klatki, kierunki, klatki). Pierwszy stan o nazwie wygrywa."""
    szer = 32
    wys = 32


def opis_dmi(sciezka):
    """Opis stanów pliku .dmi albo None, gdy pliku nie ma lub nie jest PNG."""
    try:
        with open(sciezka, "rb") as f:
            dane = f.read()
    except OSError:
        return None
    if dane[:8] != PNG_SYGNATURA:
        return None
    i = 8
    tekst = None
    szer_png = wys_png = 32
    while i + 8 <= len(dane):
        dlugosc, = struct.unpack(">I", dane[i:i + 4])
        typ = dane[i + 4:i + 8]
        tresc = dane[i + 8:i + 8 + dlugosc]
        if typ == b"IHDR":
            szer_png, wys_png = struct.unpack(">II", tresc[:8])
        if typ in (b"zTXt", b"tEXt"):
            zero = tresc.find(b"\0")
            if tresc[:zero] == b"Description":
                try:
                    tekst = (zlib.decompress(tresc[zero + 2:]) if typ == b"zTXt" else tresc[zero + 1:]).decode("utf-8", "replace")
                except zlib.error:
                    tekst = None
                break
        if typ == b"IEND":
            break
        i += 12 + dlugosc
    wynik = OpisDmi()
    if tekst is None:
        # zwykły PNG: jeden obrazek bez nazwy stanu
        wynik.szer, wynik.wys = szer_png, wys_png
        wynik[""] = (0, 1, 1)
        return wynik
    indeks = 0
    biezacy = None

    def zamknij():
        nonlocal indeks
        if biezacy is None:
            return
        nazwa, kier, klatki = biezacy
        if nazwa not in wynik:
            wynik[nazwa] = (indeks, kier, klatki)
        indeks += kier * klatki

    for linia in tekst.split("\n"):
        m = KIERUNKI_STANU.match(linia)
        if not m:
            continue
        klucz, w = m.group(1), m.group(2).strip()
        if klucz == "width":
            wynik.szer = int(w)
        elif klucz == "height":
            wynik.wys = int(w)
        elif klucz == "state":
            zamknij()
            biezacy = [w[1:-1] if w.startswith('"') and w.endswith('"') else w, 1, 1]
        elif biezacy is not None and klucz == "dirs":
            biezacy[1] = int(w)
        elif biezacy is not None and klucz == "frames":
            biezacy[2] = int(w)
    zamknij()
    return wynik


def czysta_nazwa(n):
    if not isinstance(n, str):
        return ""
    n = n.replace("\\improper", "").replace("\\proper", "").replace("\\the", "")
    n = re.sub(r"\\[a-z]+\s*", "", n)
    n = re.sub(r"\[[^\]]*\]", "", n)
    return re.sub(r"\s+", " ", n).strip()


def czysty_opis(d):
    if not isinstance(d, str):
        return ""
    d = re.sub(r"\[[^\]]*\]", "…", d)
    return re.sub(r"\\[a-z]+\s*", "", d).strip()


def kategoria(sciezka):
    s = sciezka + "/"
    if s.startswith("/obj/item/clothing/"):
        return "ubrania"
    if s.startswith(("/obj/item/gun/", "/obj/item/weapon/gun/", "/obj/item/ammo")):
        return "bronie"
    if s.startswith(("/obj/item/reagent_containers/food/", "/obj/item/food/", "/obj/item/reagent_containers/cup/", "/obj/item/reagent_containers/drinks/")):
        return "jedzenie"
    if s.startswith("/obj/item/"):
        return "przedmioty"
    if s.startswith("/obj/machinery/"):
        return "maszyny"
    if s.startswith("/obj/structure/"):
        return "struktury"
    if s.startswith("/mob/"):
        return "moby"
    if s.startswith("/turf/"):
        return "podlogi"
    return "inne"


# Człon ścieżki ubrania -> słowa w nazwie pliku ikon noszonych (icons/mob/...).
SLOTY_UBRAN = {
    "gloves": ("hands", "gloves"), "shoes": ("feet", "shoes"), "head": ("head", "hats", "helmet"),
    "suit": ("suit", "overcoats", "armor"), "suits": ("suit", "overcoats", "armor"), "under": ("uniform", "under", "jumpsuit", "worn_js"),
    "mask": ("mask",), "glasses": ("eyes", "glasses"), "neck": ("neck", "ties"), "ears": ("ears",),
    "accessory": ("accessories", "ties"), "belt": ("belt",), "backpack": ("back",), "back": ("back",),
}
POMIJANE_PLIKI = ("species", "inhand", "lefthand", "righthand", "digi", "template", "mirror", "large-worn", "_icons.dmi", "actions")


def pliki_noszone(repo):
    """Pliki .dmi z icons/mob (także w folderach modularnych, np. aquila/icons/mob)."""
    korzenie = [os.path.join(repo, "icons", "mob")]
    for nazwa in os.listdir(repo):
        if not nazwa.startswith(".") and os.path.isdir(os.path.join(repo, nazwa, "icons", "mob")):
            korzenie.append(os.path.join(repo, nazwa, "icons", "mob"))
    wynik = []
    for k in korzenie:
        for korzen, katalogi, pliki in os.walk(k):
            katalogi[:] = [d for d in katalogi if not d.startswith(".")]
            for p in pliki:
                if p.endswith(".dmi"):
                    w = os.path.relpath(os.path.join(korzen, p), repo).replace("\\", "/")
                    if not any(x in w.lower() for x in POMIJANE_PLIKI):
                        wynik.append(w)
    return sorted(wynik)


def zbuduj(dme, postep=lambda t: None):
    repo = os.path.dirname(os.path.abspath(dme))
    postep("czytam kod DM")
    typy = ekstraktor.ekstrahuj(dme)["typy"]
    postep("rozwijam dziedziczenie")

    def rodzic(sciezka):
        zm = typy.get(sciezka, {})
        if "^" in zm:
            return zm["^"]
        if sciezka in ("/obj", "/mob", "/turf", "/area"):
            return None
        r = sciezka.rsplit("/", 1)[0]
        return r or None

    pamiec = {}

    def wartosc(sciezka, nazwa, glebokosc=0):
        klucz = (sciezka, nazwa)
        if klucz in pamiec:
            return pamiec[klucz]
        pamiec[klucz] = None   # ochrona przed pętlą
        w = None
        s = sciezka
        n = 0
        while s and n < 64:
            zm = typy.get(s)
            if zm is not None and nazwa in zm:
                w = zm[nazwa]
                break
            s = rodzic(s)
            n += 1
        if isinstance(w, dict):
            if "typ" in w and glebokosc < 8:
                cel = w["typ"]
                if "::" in cel:
                    t, v = cel.split("::", 1)
                    if t == "parent_type":
                        t = rodzic(sciezka) or ""
                    w = wartosc(t, v, glebokosc + 1)
                else:
                    w = None
            elif "plik" not in w:
                w = None
        pamiec[klucz] = w
        return w

    stany_dmi = {}

    def stany(plik):
        if plik not in stany_dmi:
            stany_dmi[plik] = opis_dmi(os.path.join(repo, plik))
        return stany_dmi[plik]

    def sprite(plik, stan):
        """[plik, stan] jeśli taki stan istnieje (albo plik ma stan bez nazwy)."""
        if not isinstance(plik, dict) or "plik" not in plik:
            return None
        p = plik["plik"].replace("\\", "/")
        if not p.lower().endswith((".dmi", ".png")):
            return None
        s = stan if isinstance(stan, str) else ""
        st = stany(p)
        if not st:
            return None
        if s in st:
            return [p, s]
        return None

    podpisy = {}

    def podpis_sprite(plik, stan_):
        klucz = (plik, stan_)
        if klucz not in podpisy:
            st = stany(plik)
            n = st[stan_][0]
            podpisy[klucz] = obraz.podpis(obraz.wycinek(obraz.otworz(os.path.join(repo, plik)), n, st.szer, st.wys))
        return podpisy[klucz]

    noszone = pliki_noszone(repo)
    pliki_slotu = {}

    def dla_slotu(slot):
        """Pliki ikon noszonych pasujące do slotu, najpierw te o dokładnej nazwie (hands.dmi)."""
        if slot not in pliki_slotu:
            slowa = SLOTY_UBRAN[slot]
            pasujace = [p for p in noszone if any(s in p.lower().rsplit("/", 2)[-2] + "/" + p.lower().rsplit("/", 1)[-1] for s in slowa)]
            pasujace.sort(key=lambda p: (os.path.splitext(os.path.basename(p))[0].lower() not in slowa, "clothing" not in p.lower(), len(p)))
            pliki_slotu[slot] = pasujace
        return pliki_slotu[slot]

    def slot_ubrania(sciezka):
        czlony = sciezka.split("/")
        if sciezka.startswith("/obj/item/clothing/") and len(czlony) > 4:
            return czlony[4] if czlony[4] in SLOTY_UBRAN else None
        if sciezka.startswith(("/obj/item/storage/belt", "/obj/item/storage/backpack")):
            return czlony[4]
        return None

    wynik = []
    for sciezka, zm in typy.items():
        if not sciezka.startswith(("/obj/", "/mob/", "/turf/")):
            continue
        abstr = zm.get("abstract_type")
        if isinstance(abstr, dict) and abstr.get("typ") == sciezka:
            continue
        ikona = wartosc(sciezka, "icon")
        stan = wartosc(sciezka, "icon_state")
        glowny = sprite(ikona, stan)
        if not glowny:
            glowny = sprite(wartosc(sciezka, "icon_preview"), wartosc(sciezka, "icon_state_preview"))
        if not glowny:
            continue
        wpis = {
            "id": sciezka,
            "n": czysta_nazwa(wartosc(sciezka, "name")),
            "s": [glowny],
            "k": kategoria(sciezka),
        }
        pod = podpis_sprite(*glowny)
        if pod:
            wpis.update(pod)
        d = czysty_opis(wartosc(sciezka, "desc"))
        if d:
            wpis["d"] = d
        if sciezka.startswith("/obj/item/"):
            reka = wartosc(sciezka, "inhand_icon_state")
            if not isinstance(reka, str):
                reka = wartosc(sciezka, "item_state")
            if not isinstance(reka, str):
                reka = stan
            lewa = sprite(wartosc(sciezka, "lefthand_file"), reka)
            prawa = sprite(wartosc(sciezka, "righthand_file"), reka)
            if not lewa and not prawa:
                # goon: jeden plik na obie ręce, stany „stan-L” i „stan-R”
                plik_rak = wartosc(sciezka, "inhand_image_icon")
                lewa = sprite(plik_rak, reka + "-L") if isinstance(reka, str) else None
                prawa = sprite(plik_rak, reka + "-R") if isinstance(reka, str) else None
            if lewa:
                wpis["l"] = [lewa]
            if prawa:
                wpis["p"] = [prawa]
            noszony = wartosc(sciezka, "worn_icon_state")
            if not isinstance(noszony, str):
                noszony = stan
            postac = None
            for plik_zm, stan_zm in (("worn_icon", "worn_icon_state"), ("wear_image_icon", "wear_state"), ("mob_overlay_icon", "item_state"), ("alternate_worn_icon", "item_state")):
                s2 = wartosc(sciezka, stan_zm)
                postac = sprite(wartosc(sciezka, plik_zm), s2 if isinstance(s2, str) else noszony)
                if postac:
                    break
            slot = None if postac else slot_ubrania(sciezka)
            if slot:
                # Plik ubioru wybiera kod według slotu – szukamy stanu w plikach tego slotu.
                kandydaci = [x for x in (wartosc(sciezka, "worn_icon_state"), wartosc(sciezka, "item_state"), stan) if isinstance(x, str) and x]
                for s2 in kandydaci:
                    for plik in dla_slotu(slot):
                        st = stany(plik)
                        if st and s2 in st:
                            postac = [plik, s2]
                            break
                    if postac:
                        break
            if postac:
                wpis["w"] = [postac]
        wynik.append(wpis)
    wynik.sort(key=lambda w: w["id"])
    postep("gotowe")
    return {"rodzaj": "ss13", "przedmioty": wynik}
