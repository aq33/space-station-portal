"""Lokalny serwer Space Station Portal – porównywarki sprite'ów i dźwięków.

Trzyma listę repozytoriów (repozytoria.json), buduje w tle indeks sprite'ów
każdego z nich (SS13: kod DM + .dmi, SS14: prototypy YAML + .rsi) i serwuje
interfejs z folderu web/ oraz pliki ikon z repozytoriów. Nasłuchuje tylko lokalnie.

Użycie: python serwer.py [--port 8615] [--bez-przegladarki]
"""

import argparse
import gzip
import hashlib
import json
import mimetypes
import os
import queue
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

import dzwieki
import ekstraktor
import hud
import indeks_ss13
import indeks_ss14
import obraz
import sciezki

TUTAJ = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(TUTAJ, "web")
DANE = os.path.join(TUTAJ, "dane")
KLONY = os.path.join(TUTAJ, "repo")
LISTA = os.path.join(TUTAJ, "repozytoria.json")
RECZNE = os.path.join(TUTAJ, "reczne.json")
WERSJA_INDEKSU = 2

# Wzorce rzadkiego checkoutu przy klonowaniu z GitHuba: tylko kod i grafika.
WZORCE_SS13 = ["/*", "!/tgui/", "!/html/", "!/SQL/", "!/tools/*", "/tools/UpdatePaths/",
               "!/node_modules/", "!/bin/", "!/config/", "!/strings/",
               "!*.dmm", "!*.dll", "!*.pdb", "!*.so"]
WZORCE_SS14 = ["/Resources/Prototypes/", "/Resources/Textures/", "/Resources/Audio/", "/Content.*/**/*.cs"]
TYPY_PLIKOW = {".dmi": "image/png", ".png": "image/png", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav",
               ".mp3": "audio/mpeg", ".flac": "audio/flac", ".mid": "audio/midi", ".json": "application/json"}

blokada = threading.Lock()
kolejka = queue.Queue()
stan = {}          # id -> {"etap", "blad", "liczba", "czas"}


# ---------------------------------------------------------------- repozytoria

def wczytaj_liste():
    try:
        with open(LISTA, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return []


def zapisz_liste(lista):
    with open(LISTA, "w", encoding="utf-8", newline="\n") as f:
        json.dump(lista, f, ensure_ascii=False, indent=2)
        f.write("\n")


def rozpoznaj(sciezka):
    """Zwraca (rodzaj, plik_dme albo None, komunikat_bledu)."""
    if not os.path.isdir(sciezka):
        return None, None, "Nie ma takiego folderu."
    dme = sorted(f for f in os.listdir(sciezka) if f.lower().endswith(".dme"))
    if dme:
        if not os.path.isdir(os.path.join(sciezka, "icons")):
            return None, None, "Jest plik .dme, ale nie ma folderu icons (klon bez ikon?)."
        return "ss13", os.path.join(sciezka, dme[0]), None
    if os.path.isdir(os.path.join(sciezka, "Resources", "Prototypes")) and os.path.isdir(os.path.join(sciezka, "Resources", "Textures")):
        return "ss14", None, None
    return None, None, "To nie wygląda na repo SS13 (brak .dme) ani SS14 (brak Resources/Prototypes)."


def id_repo(sciezka):
    return hashlib.sha1(os.path.normcase(os.path.abspath(sciezka)).encode()).hexdigest()[:10]


def wersja_git(sciezka):
    try:
        w = subprocess.run(["git", "-C", sciezka, "log", "-1", "--format=%H %cs"], capture_output=True, text=True, timeout=10)
        if w.returncode == 0 and w.stdout.strip():
            sha, data = w.stdout.split()
            return {"sha": sha, "data": data}
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    return None


def plik_indeksu(rid):
    return os.path.join(DANE, "indeks-%s.json.gz" % rid)


def plik_dzwiekow(rid):
    return os.path.join(DANE, "dzwieki-%s.json.gz" % rid)


def plik_hud(rid):
    return os.path.join(DANE, "hud-%s.json.gz" % rid)


def adres_github(repo):
    """https://github.com/właściciel/repo (do linków „pokaż w kodzie”) albo None.

    Bierze remote origin, a gdy go nie ma – pierwszy remote wskazujący na GitHuba (np. „aq33”).
    """
    wzor = re.compile(r"^(?:https://github\.com/|git@github\.com:)([\w.-]+)/([\w.-]+?)(?:\.git)?/?$")
    adresy = [repo["zrodlo"]] if repo.get("zrodlo") else []
    if not adresy:
        try:
            w = subprocess.run(["git", "-C", repo["sciezka"], "remote", "-v"], capture_output=True, text=True, timeout=10,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            linie = [l.split() for l in w.stdout.splitlines() if l.strip()] if w.returncode == 0 else []
            linie.sort(key=lambda l: l[0] != "origin")
            adresy = [l[1] for l in linie if len(l) > 1]
        except (OSError, subprocess.SubprocessError):
            pass
    for url in adresy:
        m = wzor.match(url)
        if m:
            return "https://github.com/%s/%s" % (m.group(1), m.group(2))
    return None


def sha_na_githubie(repo):
    """Commit, który na pewno jest na GitHubie: wspólny przodek HEAD i gałęzi zdalnej (lokalne commity tam nie istnieją)."""
    if repo.get("zrodlo"):
        return None   # nasz klon: HEAD pochodzi z GitHuba
    sciezka = repo["sciezka"]
    flagi = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        zdalne = subprocess.run(["git", "-C", sciezka, "for-each-ref", "--format=%(refname:short)", "refs/remotes"],
                                capture_output=True, text=True, timeout=10, creationflags=flagi).stdout.split()
        # najpierw gałęzie główne (origin/HEAD, aq33/master…), „aq33” samo to skrót od aq33/HEAD
        glowne = [r for r in zdalne if "/" not in r or r.endswith(("/HEAD", "/master", "/main"))]
        glowne.sort(key=lambda r: not r.startswith("origin"))
        for ref in glowne[:4]:
            w = subprocess.run(["git", "-C", sciezka, "merge-base", "HEAD", ref], capture_output=True, text=True, timeout=20, creationflags=flagi)
            if w.returncode == 0 and w.stdout.strip():
                return w.stdout.strip()
        # płytki klon: wspólnego przodka nie widać, więc bierzemy czubek gałęzi głównej
        for ref in glowne[:4]:
            w = subprocess.run(["git", "-C", sciezka, "rev-parse", ref], capture_output=True, text=True, timeout=10, creationflags=flagi)
            if w.returncode == 0 and w.stdout.strip():
                return w.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def odcisk(repo):
    """Wersja kodu + wersja indeksera: zmiana któregoś unieważnia zapisany indeks."""
    g = wersja_git(repo["sciezka"])
    narzedzia = max(os.path.getmtime(m.__file__) for m in (ekstraktor, indeks_ss13, indeks_ss14, obraz, dzwieki, hud))
    return "%s|%d|%d" % (g["sha"] if g else "brak-git", int(narzedzia), WERSJA_INDEKSU)


def aktualny(repo):
    p = plik_indeksu(repo["id"])
    if not os.path.exists(p) or not os.path.exists(plik_dzwiekow(repo["id"])) or not os.path.exists(plik_hud(repo["id"])):
        return False
    try:
        with gzip.open(p, "rt", encoding="utf-8") as f:
            naglowek = f.readline()
        return json.loads(naglowek).get("odcisk") == odcisk(repo)
    except (OSError, ValueError):
        return False


def buduj(repo):
    rid = repo["id"]
    t0 = time.time()

    def postep(tekst):
        stan[rid]["etap"] = tekst

    stan[rid] = {"etap": "start", "blad": None}
    try:
        rodzaj, dme, blad = rozpoznaj(repo["sciezka"])
        if blad:
            raise RuntimeError(blad)
        odc = odcisk(repo)
        dane = indeks_ss13.zbuduj(dme, postep) if rodzaj == "ss13" else indeks_ss14.zbuduj(repo["sciezka"], postep)
        dane["wersja"] = wersja_git(repo["sciezka"])
        dane["github"] = adres_github(repo)
        os.makedirs(DANE, exist_ok=True)
        # Dźwięki w osobnym pliku (zapisany przed głównym indeksem, który świadczy o kompletności).
        dz = dzwieki.zbuduj(repo["sciezka"], rodzaj, postep)
        with gzip.open(plik_dzwiekow(rid), "wt", encoding="utf-8", compresslevel=6) as f:
            f.write(json.dumps(dz, ensure_ascii=False, separators=(",", ":")))
        ikony = hud.zbuduj(repo["sciezka"], rodzaj, postep)
        with gzip.open(plik_hud(rid), "wt", encoding="utf-8", compresslevel=6) as f:
            f.write(json.dumps(ikony, ensure_ascii=False, separators=(",", ":")))
        tymczasowy = plik_indeksu(rid) + ".tmp"
        # Pierwsza linia to nagłówek z odciskiem – da się go przeczytać bez całego pliku.
        with gzip.open(tymczasowy, "wt", encoding="utf-8", compresslevel=6) as f:
            f.write(json.dumps({"odcisk": odc}) + "\n")
            f.write(json.dumps(dane, ensure_ascii=False, separators=(",", ":")))
        os.replace(tymczasowy, plik_indeksu(rid))
        stan[rid] = {"etap": "gotowe", "blad": None, "liczba": len(dane["przedmioty"]), "czas": round(time.time() - t0, 1)}
        print("Indeks %s: %d sprite'ów w %.1f s" % (repo["nazwa"], len(dane["przedmioty"]), time.time() - t0), flush=True)
    except Exception as e:   # noqa: BLE001 – błąd ma trafić do interfejsu
        traceback.print_exc()
        stan[rid] = {"etap": "błąd", "blad": str(e)}


def git(argumenty, postep=None, cwd=None):
    """Uruchamia git; postep(tekst) dostaje ostatni komunikat (np. „Receiving objects: 45%”)."""
    proc = subprocess.Popen(["git", *argumenty], cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    bledy = []
    bufor = b""
    while True:
        kawalek = proc.stderr.read(256)
        if not kawalek:
            break
        bufor += kawalek
        *linie, bufor = bufor.replace(b"\r", b"\n").split(b"\n")
        for l in linie:
            t = l.decode("utf-8", "replace").strip()
            if t:
                bledy.append(t)
                if postep and re.search(r"\d+%", t):
                    postep(t.replace("remote: ", ""))
    wyjscie = proc.stdout.read().decode("utf-8", "replace")
    if proc.wait() != 0:
        raise RuntimeError("git %s: %s" % (argumenty[0], (bledy[-1] if bledy else "błąd")))
    return wyjscie


def klonuj(repo, aktualizuj=False):
    """Rzadki klon z GitHuba do folderu repo/ (kod, grafika i dźwięki, bez map i narzędzi)."""
    rid = repo["id"]
    cel = repo["sciezka"]

    def postep(t):
        stan[rid]["etap"] = ("aktualizuję: " if aktualizuj else "pobieram: ") + t

    if aktualizuj and os.path.isdir(os.path.join(cel, ".git")):
        stan[rid] = {"etap": "aktualizuję z GitHuba", "blad": None}
        git(["-C", cel, "fetch", "--depth", "1", "--filter=blob:none", "--progress", "origin"], postep)
        git(["-C", cel, "reset", "--hard", "FETCH_HEAD"], postep)
        # wzorce mogły się zmienić od klonowania (np. dźwięki doszły później)
        wzorce = WZORCE_SS14 if repo.get("rodzaj") == "ss14" else WZORCE_SS13
        stan[rid]["etap"] = "dociągam brakujące pliki"
        git(["-C", cel, "sparse-checkout", "set", "--no-cone", *wzorce], postep)
        return
    stan[rid] = {"etap": "pobieram z GitHuba", "blad": None}
    os.makedirs(KLONY, exist_ok=True)
    argumenty = ["clone", "--depth", "1", "--filter=blob:none", "--no-checkout", "--progress"]
    if repo.get("galaz"):
        argumenty += ["--branch", repo["galaz"]]
    try:
        git(argumenty + [repo["zrodlo"], cel], postep)
        pliki = git(["-C", cel, "ls-tree", "--name-only", "HEAD"]).split()
        if any(p.lower().endswith(".dme") for p in pliki):
            wzorce = WZORCE_SS13
        elif "Resources" in pliki:
            wzorce = WZORCE_SS14
        else:
            raise RuntimeError("To repo nie wygląda na SS13 (brak .dme) ani SS14 (brak Resources).")
        git(["-C", cel, "sparse-checkout", "set", "--no-cone", *wzorce])
        stan[rid]["etap"] = "pobieram pliki kodu i grafiki"
        git(["-C", cel, "checkout", "--progress"], postep)
    except Exception:
        # niedokończony klon usuwamy, żeby następna próba zaczęła od zera
        usun_klon(cel)
        raise


def usun_klon(sciezka):
    """Usuwa folder tylko wtedy, gdy to nasz klon w repo/ (nigdy repo użytkownika)."""
    p = os.path.normcase(os.path.abspath(sciezka))
    if os.path.commonpath([p, os.path.normcase(KLONY)]) == os.path.normcase(KLONY) and p != os.path.normcase(KLONY):
        def zdejmij_ochrone(funkcja, sciezka_, _):
            os.chmod(sciezka_, 0o700)
            funkcja(sciezka_)
        shutil.rmtree(p, onerror=zdejmij_ochrone)


def pracownik():
    while True:
        rid, wymus, aktualizuj = kolejka.get()
        repo = next((r for r in wczytaj_liste() if r["id"] == rid), None)
        try:
            if repo and repo.get("zrodlo") and (aktualizuj or not os.path.isdir(os.path.join(repo["sciezka"], ".git"))):
                klonuj(repo, aktualizuj)
                rodzaj, _, blad = rozpoznaj(repo["sciezka"])
                if blad:
                    raise RuntimeError(blad)
                with blokada:
                    lista = wczytaj_liste()
                    for r in lista:
                        if r["id"] == rid:
                            r["rodzaj"] = rodzaj
                    zapisz_liste(lista)
                repo["rodzaj"] = rodzaj
                wymus = True
            if repo and (wymus or not aktualny(repo)):
                buduj(repo)
            elif repo:
                stan[rid] = {"etap": "gotowe", "blad": None}
        except Exception as e:   # noqa: BLE001 – błąd ma trafić do interfejsu
            traceback.print_exc()
            stan[rid] = {"etap": "błąd", "blad": str(e)}
        kolejka.task_done()


def zlec(rid, wymus=False, aktualizuj=False):
    stan[rid] = {"etap": "w kolejce", "blad": None}
    kolejka.put((rid, wymus, aktualizuj))


pamiec_regul = {"klucz": None, "dane": None}


def reguly_sciezek():
    repa = [r["sciezka"] for r in wczytaj_liste() if r.get("rodzaj") == "ss13"]
    klucz = json.dumps(repa)
    if pamiec_regul["klucz"] != klucz:
        pamiec_regul["dane"] = sciezki.zbierz(repa)
        pamiec_regul["klucz"] = klucz
    return pamiec_regul["dane"]


def wczytaj_reczne():
    try:
        with open(RECZNE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"pary": {}}


def wybierz_folder():
    """Systemowe okno wyboru folderu (serwer działa na tym samym komputerze)."""
    import tkinter
    from tkinter import filedialog
    okno = tkinter.Tk()
    okno.withdraw()
    okno.attributes("-topmost", True)
    try:
        return filedialog.askdirectory(title="Wybierz folder repozytorium SS13/SS14", mustexist=True) or ""
    finally:
        okno.destroy()


def nazwa_z_url(url):
    m = re.match(r"^https?://github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?/?(?:tree/([^?#]+))?$", url.strip())
    if not m:
        return None
    return m.group(1), m.group(2), m.group(3)


pamiec_github = {}


def opis_repo(r):
    s = stan.get(r["id"]) or {"etap": "gotowe" if os.path.exists(plik_indeksu(r["id"])) else "brak", "blad": None}
    if r["id"] not in pamiec_github or s.get("etap") != "gotowe":
        pamiec_github[r["id"]] = (adres_github(r), sha_na_githubie(r))
    url, sha = pamiec_github[r["id"]]
    return dict(r, **{"stan": s, "github": url, "github_sha": sha})


def propozycje():
    """Foldery obok tego projektu (np. na Pulpicie), które wyglądają na repo SS13/SS14."""
    wynik = []
    znane = {os.path.normcase(os.path.abspath(r["sciezka"])) for r in wczytaj_liste()}
    rodzic = os.path.dirname(TUTAJ)
    kandydaci = []
    for nazwa in sorted(os.listdir(rodzic)):
        p = os.path.join(rodzic, nazwa)
        if os.path.isdir(p):
            kandydaci.append(p)
            # repo zagnieżdżone o jeden poziom (np. NSV13-master/bee)
            try:
                for pod in os.listdir(p):
                    q = os.path.join(p, pod)
                    if os.path.isdir(q) and any(f.lower().endswith(".dme") for f in os.listdir(q)):
                        kandydaci.append(q)
            except OSError:
                pass
    for p in kandydaci:
        try:
            rodzaj, _, blad = rozpoznaj(p)
        except OSError:
            continue
        if rodzaj and os.path.normcase(os.path.abspath(p)) not in znane:
            wynik.append({"sciezka": p, "nazwa": os.path.relpath(p, rodzic).replace("\\", "/"), "rodzaj": rodzaj})
    return wynik


# ---------------------------------------------------------------- HTTP

class Obsluga(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"   # keep-alive: ikon są setki

    def log_message(self, fmt, *args):
        if args and isinstance(args[0], str) and ("/plik/" in args[0] or "/api/repo " in args[0]):
            return
        sys.stderr.write("%s\n" % (fmt % args))

    def _wyslij(self, kod, tresc, typ="application/json; charset=utf-8", naglowki=None):
        self.send_response(kod)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(tresc)))
        for k, v in (naglowki or {"Cache-Control": "no-store"}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(tresc)

    def _json(self, obiekt, kod=200):
        self._wyslij(kod, json.dumps(obiekt, ensure_ascii=False).encode("utf-8"))

    def _tresc(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def _z_interfejsu(self):
        # Zmiany tylko z naszej strony (ochrona przed żądaniami z innych witryn).
        poch = self.headers.get("Origin")
        return poch is None or urlparse(poch).hostname in ("127.0.0.1", "localhost", "::1")

    def do_GET(self):
        url = urlparse(self.path)
        sciezka = unquote(url.path)
        if sciezka == "/api/repo":
            return self._json([opis_repo(r) for r in wczytaj_liste()])
        if sciezka == "/api/propozycje":
            return self._json(propozycje())
        if sciezka == "/dane/strona.json":
            return self._json({"tryb": "lokalny"})   # strona sprawdza tym, czy działa online
        if sciezka == "/api/sciezki":
            return self._json(reguly_sciezek())
        if sciezka == "/api/reczne":
            return self._json(wczytaj_reczne())
        if sciezka.startswith(("/api/dzwieki/", "/api/hud/")):
            rid = sciezka.rsplit("/", 1)[1]
            p = plik_hud(rid) if sciezka.startswith("/api/hud/") else plik_dzwiekow(rid)
            if not os.path.exists(p):
                return self._json({"blad": "brak indeksu"}, 404)
            with open(p, "rb") as f:
                return self._wyslij(200, f.read(), naglowki={"Content-Encoding": "gzip", "Cache-Control": "no-store"})
        if sciezka.startswith("/api/indeks/"):
            rid = sciezka.rsplit("/", 1)[1]
            p = plik_indeksu(rid)
            if not os.path.exists(p):
                return self._json({"blad": "brak indeksu"}, 404)
            with gzip.open(p, "rt", encoding="utf-8") as f:
                f.readline()
                tresc = f.read().encode("utf-8")
            return self._wyslij(200, gzip.compress(tresc, 1), naglowki={"Content-Encoding": "gzip", "Cache-Control": "no-store"})
        if sciezka.startswith("/plik/"):
            # /plik/<id repo>/<ścieżka względna>
            _, _, rid, wzgledna = sciezka.split("/", 3)
            repo = next((r for r in wczytaj_liste() if r["id"] == rid), None)
            if not repo:
                return self._json({"blad": "nieznane repo"}, 404)
            baza = os.path.normcase(os.path.abspath(repo["sciezka"]))
            plik = os.path.normcase(os.path.abspath(os.path.join(baza, wzgledna)))
            if os.path.commonpath([plik, baza]) != baza or not os.path.isfile(plik):
                return self._json({"blad": "brak pliku"}, 404)
            with open(plik, "rb") as f:
                tresc = f.read()
            typ = TYPY_PLIKOW.get(os.path.splitext(plik)[1].lower()) or mimetypes.guess_type(plik)[0] or "application/octet-stream"
            return self._wyslij(200, tresc, typ, {"Cache-Control": "max-age=60"})
        # interfejs
        if sciezka == "/":
            sciezka = "/index.html"
        plik = os.path.normpath(os.path.join(WEB, sciezka.lstrip("/")))
        if os.path.commonpath([plik, WEB]) != WEB or not os.path.isfile(plik):
            return self._wyslij(404, b"nie ma", "text/plain; charset=utf-8")
        typ = mimetypes.guess_type(plik)[0] or "application/octet-stream"
        if plik.endswith(".js"):
            typ = "text/javascript"
        with open(plik, "rb") as f:
            self._wyslij(200, f.read(), typ + ("; charset=utf-8" if typ.startswith("text") else ""))

    def do_POST(self):
        if not self._z_interfejsu():
            return self._json({"blad": "zła strona"}, 403)
        sciezka = urlparse(self.path).path
        dane = self._tresc()
        if sciezka == "/api/repo":
            p = os.path.abspath(str(dane.get("sciezka", "")).strip().strip('"'))
            rodzaj, _, blad = rozpoznaj(p)
            if blad:
                return self._json({"blad": blad}, 400)
            with blokada:
                lista = wczytaj_liste()
                rid = id_repo(p)
                if any(r["id"] == rid for r in lista):
                    return self._json({"blad": "To repo już jest na liście."}, 400)
                nazwa = str(dane.get("nazwa") or "").strip() or os.path.basename(p)
                lista.append({"id": rid, "nazwa": nazwa, "sciezka": p, "rodzaj": rodzaj})
                zapisz_liste(lista)
            zlec(rid)
            return self._json({"id": rid})
        if sciezka == "/api/odswiez":
            zlec(str(dane.get("id")), wymus=True, aktualizuj=bool(dane.get("aktualizuj")))
            return self._json({"ok": True})
        if sciezka == "/api/klonuj":
            url = str(dane.get("url", "")).strip()
            czesci = nazwa_z_url(url)
            if not czesci:
                return self._json({"blad": "Podaj link w postaci https://github.com/właściciel/repo (może być z /tree/gałąź)."}, 400)
            wlasciciel, nazwa_repo, galaz = czesci
            folder = os.path.join(KLONY, "%s__%s%s" % (wlasciciel, nazwa_repo, ("__" + re.sub(r"\W+", "_", galaz)) if galaz else ""))
            with blokada:
                lista = wczytaj_liste()
                rid = id_repo(folder)
                if any(r["id"] == rid for r in lista):
                    return self._json({"blad": "To repo już jest na liście."}, 400)
                lista.append({
                    "id": rid, "nazwa": str(dane.get("nazwa") or "").strip() or nazwa_repo, "sciezka": folder, "rodzaj": "?",
                    "zrodlo": "https://github.com/%s/%s.git" % (wlasciciel, nazwa_repo), "galaz": galaz or None,
                })
                zapisz_liste(lista)
            zlec(rid)
            return self._json({"id": rid})
        if sciezka == "/api/wybierz-folder":
            try:
                return self._json({"sciezka": wybierz_folder()})
            except Exception as e:   # noqa: BLE001
                return self._json({"blad": "Nie udało się otworzyć okna wyboru: %s" % e}, 500)
        if sciezka == "/api/reczne":
            if not isinstance(dane.get("pary"), dict):
                return self._json({"blad": "zły format"}, 400)
            with blokada:
                with open(RECZNE, "w", encoding="utf-8", newline="\n") as f:
                    json.dump({"pary": dane["pary"]}, f, ensure_ascii=False, indent=1, sort_keys=True)
                    f.write("\n")
            return self._json({"ok": True})
        if sciezka == "/api/zmien":
            with blokada:
                lista = wczytaj_liste()
                for r in lista:
                    if r["id"] == dane.get("id") and isinstance(dane.get("nazwa"), str) and dane["nazwa"].strip():
                        r["nazwa"] = dane["nazwa"].strip()
                if isinstance(dane.get("kolejnosc"), list):
                    poz = {rid: i for i, rid in enumerate(dane["kolejnosc"])}
                    lista.sort(key=lambda r: poz.get(r["id"], 999))
                zapisz_liste(lista)
            return self._json({"ok": True})
        if sciezka == "/api/usun":
            with blokada:
                stara = wczytaj_liste()
                lista = [r for r in stara if r["id"] != dane.get("id")]
                zapisz_liste(lista)
            for r in stara:
                if r["id"] == dane.get("id") and r.get("zrodlo"):
                    try:
                        usun_klon(r["sciezka"])   # klon pobrany przez Portal
                    except OSError:
                        pass
            try:
                os.remove(plik_indeksu(str(dane.get("id"))))
                os.remove(plik_dzwiekow(str(dane.get("id"))))
                os.remove(plik_hud(str(dane.get("id"))))
            except OSError:
                pass
            return self._json({"ok": True})
        return self._json({"blad": "nieznane"}, 404)


def main():
    a = argparse.ArgumentParser(description="Space Station Portal: sprite'y i dźwięki SS13/SS14")
    a.add_argument("--port", type=int, default=8615)
    a.add_argument("--bez-przegladarki", action="store_true")
    arg = a.parse_args()
    threading.Thread(target=pracownik, daemon=True).start()
    for r in wczytaj_liste():
        zlec(r["id"])   # sprawdzi odcisk i przebuduje tylko nieaktualne
    serwer = ThreadingHTTPServer(("127.0.0.1", arg.port), Obsluga)
    # „localhost” w przeglądarce idzie najpierw na ::1 – bez tego każde połączenie czeka.
    try:
        class Serwer6(ThreadingHTTPServer):
            address_family = socket.AF_INET6
        serwer6 = Serwer6(("::1", arg.port), Obsluga)
        threading.Thread(target=serwer6.serve_forever, daemon=True).start()
    except OSError:
        pass
    adres = "http://127.0.0.1:%d/" % arg.port
    print("Space Station Portal działa: %s" % adres, flush=True)
    if not arg.bez_przegladarki:
        webbrowser.open(adres)
    try:
        serwer.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
