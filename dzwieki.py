"""Indeks dźwięków repozytorium: pliki, długość, skrót zawartości i miejsca użycia w kodzie.

SS13: pliki .ogg/.wav/.mp3/.mid śledzone przez gita (także w folderach modularnych,
np. aquila/sound), a użycia to dosłowne ścieżki 'sound/...' w plikach .dm.
SS14: pliki z Resources/Audio, użycia to ścieżki /Audio/... w prototypach YAML i kodzie C#
oraz kolekcje soundCollection (użycie kolekcji liczy się każdemu jej plikowi).
Licencje SS14 są brane z plików attributions.yml.
"""

import hashlib
import os
import re
import struct
import subprocess
import wave

import yaml

ROZSZERZENIA = (".ogg", ".wav", ".mp3", ".mid", ".midi", ".flac", ".opus")
MAKS_UZYC = 60

_SS13_ODWOLANIE = re.compile(r"""['"]([\w./ \-]+\.(?:ogg|wav|mp3|mid|midi|flac))['"]""", re.I)
_SS14_ODWOLANIE = re.compile(r"""(/Audio/[^"'\s,\]}]+\.(?:ogg|wav|mp3|flac|opus))""", re.I)
_SS14_KOLEKCJA = re.compile(r"""\bcollection:\s*([\w-]+)""")


def pliki_gita(repo, wzorce=None):
    """Pliki śledzone przez gita (bez nieśledzonych folderów, np. kopii innych repo w środku)."""
    try:
        w = subprocess.run(["git", "-C", repo, "ls-files", "-z", *(wzorce or [])], capture_output=True, timeout=120,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if w.returncode == 0:
            return [p for p in w.stdout.decode("utf-8", "replace").split("\0") if p]
    except (OSError, subprocess.SubprocessError):
        pass
    wynik = []
    for korzen, katalogi, pliki in os.walk(repo):
        katalogi[:] = [k for k in katalogi if not k.startswith(".") and k != "node_modules"]
        for p in pliki:
            wynik.append(os.path.relpath(os.path.join(korzen, p), repo).replace("\\", "/"))
    return wynik


def czas_trwania(sciezka):
    """Długość w sekundach albo None (ogg vorbis/opus i wav; mp3 i mid bez długości)."""
    try:
        if sciezka.lower().endswith(".wav"):
            with wave.open(sciezka, "rb") as w:
                return round(w.getnframes() / float(w.getframerate()), 2)
        if not sciezka.lower().endswith((".ogg", ".opus")):
            return None
        with open(sciezka, "rb") as f:
            poczatek = f.read(4096)
            f.seek(0, 2)
            rozmiar = f.tell()
            f.seek(max(0, rozmiar - 65536))
            koniec = f.read()
        przesuniecie = 0
        i = poczatek.find(b"\x01vorbis")
        if i >= 0:
            czestotliwosc = struct.unpack("<I", poczatek[i + 12:i + 16])[0]
        else:
            j = poczatek.find(b"OpusHead")
            if j < 0:
                return None
            czestotliwosc = 48000
            przesuniecie = struct.unpack("<H", poczatek[j + 10:j + 12])[0]
        k = koniec.rfind(b"OggS")
        if k < 0 or not czestotliwosc:
            return None
        granula = struct.unpack("<q", koniec[k + 6:k + 14])[0]
        return round(max(0, granula - przesuniecie) / czestotliwosc, 2)
    except (OSError, EOFError, wave.Error, struct.error, ZeroDivisionError):
        return None


def skrot(sciezka):
    h = hashlib.sha1()
    with open(sciezka, "rb") as f:
        for kawalek in iter(lambda: f.read(1 << 20), b""):
            h.update(kawalek)
    return h.hexdigest()[:12]


def _czytaj(sciezka):
    try:
        with open(sciezka, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def _uzycie(uzycia, klucz, plik, nr, linia, przez=None):
    lista = uzycia.setdefault(klucz, [])
    if len(lista) < MAKS_UZYC:
        wpis = [plik, nr, linia.strip()[:160]]
        if przez:
            wpis.append(przez)
        lista.append(wpis)
    licznik = uzycia.setdefault("#" + klucz, [0])
    licznik[0] += 1


def uzycia_ss13(repo, pliki):
    uzycia = {}
    for plik in pliki:
        if not plik.endswith(".dm"):
            continue
        tekst = _czytaj(os.path.join(repo, plik))
        if ".ogg" not in tekst and ".wav" not in tekst and ".mp3" not in tekst and ".mid" not in tekst:
            continue
        for nr, linia in enumerate(tekst.split("\n"), 1):
            if linia.lstrip().startswith("//"):
                continue
            for m in _SS13_ODWOLANIE.finditer(linia):
                _uzycie(uzycia, m.group(1).replace("\\", "/").lstrip("./").lower(), plik, nr, linia)
    return uzycia


def _licencje_ss14(repo, pliki):
    wynik = {}
    for plik in pliki:
        if not plik.endswith("attributions.yml"):
            continue
        katalog = plik.rsplit("/", 1)[0]
        try:
            dane = yaml.safe_load(_czytaj(os.path.join(repo, plik))) or []
        except yaml.YAMLError:
            continue
        for wpis in dane if isinstance(dane, list) else []:
            if not isinstance(wpis, dict):
                continue
            nazwy = []
            for f in wpis.get("files") or []:
                nazwy.extend(x.strip() for x in str(f).split(","))
            opis = " · ".join(str(wpis[k]) for k in ("license", "copyright") if wpis.get(k))
            for n in nazwy:
                if n:
                    wynik[(katalog + "/" + n).lower()] = [opis, str(wpis.get("source") or "")]
    return wynik


def uzycia_ss14(repo, pliki):
    uzycia = {}
    kolekcje = {}
    # najpierw kolekcje: id -> pliki
    for plik in pliki:
        if not plik.endswith(".yml") or not plik.startswith("Resources/Prototypes/"):
            continue
        tekst = _czytaj(os.path.join(repo, plik))
        if "soundCollection" not in tekst:
            continue
        for blok in re.split(r"(?m)^- ", tekst):
            if "type: soundCollection" not in blok:
                continue
            m = re.search(r"(?m)^\s*id:\s*([\w-]+)", blok)
            if m:
                kolekcje[m.group(1)] = [x.lower() for x in _SS14_ODWOLANIE.findall(blok)]
    for plik in pliki:
        if not (plik.endswith((".yml", ".cs")) and (plik.startswith("Resources/") or plik.startswith("Content."))):
            continue
        tekst = _czytaj(os.path.join(repo, plik))
        if "/Audio/" not in tekst and "collection:" not in tekst:
            continue
        for nr, linia in enumerate(tekst.split("\n"), 1):
            if linia.lstrip().startswith(("#", "//")):
                continue
            if "/Audio/" in linia:
                # pliki kolekcji to definicja, nie użycie
                for m in _SS14_ODWOLANIE.finditer(linia):
                    _uzycie(uzycia, m.group(1).lower(), plik, nr, linia)
            if "collection:" in linia:
                for m in _SS14_KOLEKCJA.finditer(linia):
                    for f in kolekcje.get(m.group(1), []):
                        _uzycie(uzycia, f, plik, nr, linia, m.group(1))
    return uzycia, kolekcje


def zbuduj(repo, rodzaj, postep=lambda t: None):
    postep("szukam dźwięków")
    pliki = pliki_gita(repo)
    if rodzaj == "ss14":
        dzwieki = [p for p in pliki if p.startswith("Resources/Audio/") and p.lower().endswith(ROZSZERZENIA)]
    else:
        dzwieki = [p for p in pliki if p.lower().endswith(ROZSZERZENIA) and not p.startswith(("tools/", "config/", ".github/"))]
    dzwieki = [p for p in dzwieki if os.path.isfile(os.path.join(repo, p))]   # rzadki klon może nie mieć plików
    postep("szukam użyć dźwięków w kodzie")
    licencje = {}
    kolekcje = {}
    if rodzaj == "ss14":
        uzycia, kolekcje = uzycia_ss14(repo, pliki)
        licencje = _licencje_ss14(repo, pliki)
    else:
        uzycia = uzycia_ss13(repo, pliki)
    postep("czytam pliki dźwięków (%d)" % len(dzwieki))
    w_kolekcjach = {}
    for k, fs in kolekcje.items():
        for f in fs:
            w_kolekcjach.setdefault(f, []).append(k)
    wynik = []
    for p in sorted(dzwieki):
        pelna = os.path.join(repo, p)
        klucz = ("/" + p[len("Resources/"):]).lower() if rodzaj == "ss14" else p.lower()
        wpis = {"p": p, "b": os.path.getsize(pelna), "h": skrot(pelna)}
        t = czas_trwania(pelna)
        if t is not None:
            wpis["t"] = t
        u = uzycia.get(klucz)
        if u:
            wpis["u"] = u
            wpis["n"] = uzycia["#" + klucz][0]
        if rodzaj == "ss14":
            lic = licencje.get(p.rsplit("/", 1)[0].lower() + "/" + p.rsplit("/", 1)[1].lower())
            if lic:
                wpis["l"], wpis["z"] = lic
            if klucz in w_kolekcjach:
                wpis["c"] = w_kolekcjach[klucz]
        wynik.append(wpis)
    # odwołania do plików, których nie ma (literówki, usunięte dźwięki)
    istniejace = {("/" + p[len("Resources/"):]).lower() if rodzaj == "ss14" else p.lower() for p in dzwieki}
    brakujace = [{"p": k, "u": v, "n": uzycia["#" + k][0]} for k, v in uzycia.items() if not k.startswith("#") and k not in istniejace]
    brakujace.sort(key=lambda x: x["p"])
    postep("gotowe")
    return {"dzwieki": wynik, "brakujace": brakujace}
