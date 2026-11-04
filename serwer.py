"""Lokalny serwer porównywarki sprite'ów.

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
import socket
import subprocess
import sys
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

import ekstraktor
import indeks_ss13
import indeks_ss14

TUTAJ = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(TUTAJ, "web")
DANE = os.path.join(TUTAJ, "dane")
LISTA = os.path.join(TUTAJ, "repozytoria.json")
WERSJA_INDEKSU = 1

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


def odcisk(repo):
    """Wersja kodu + wersja indeksera: zmiana któregoś unieważnia zapisany indeks."""
    g = wersja_git(repo["sciezka"])
    narzedzia = max(os.path.getmtime(m.__file__) for m in (ekstraktor, indeks_ss13, indeks_ss14))
    return "%s|%d|%d" % (g["sha"] if g else "brak-git", int(narzedzia), WERSJA_INDEKSU)


def aktualny(repo):
    p = plik_indeksu(repo["id"])
    if not os.path.exists(p):
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
        os.makedirs(DANE, exist_ok=True)
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


def pracownik():
    while True:
        rid, wymus = kolejka.get()
        repo = next((r for r in wczytaj_liste() if r["id"] == rid), None)
        if repo and (wymus or not aktualny(repo)):
            buduj(repo)
        elif repo:
            stan[rid] = {"etap": "gotowe", "blad": None}
        kolejka.task_done()


def zlec(rid, wymus=False):
    stan[rid] = {"etap": "w kolejce", "blad": None}
    kolejka.put((rid, wymus))


def opis_repo(r):
    s = stan.get(r["id"]) or {"etap": "gotowe" if os.path.exists(plik_indeksu(r["id"])) else "brak", "blad": None}
    return dict(r, **{"stan": s})


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
            typ = "image/png" if plik.endswith((".dmi", ".png")) else (mimetypes.guess_type(plik)[0] or "application/octet-stream")
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
            zlec(str(dane.get("id")), wymus=True)
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
                lista = [r for r in wczytaj_liste() if r["id"] != dane.get("id")]
                zapisz_liste(lista)
            try:
                os.remove(plik_indeksu(str(dane.get("id"))))
            except OSError:
                pass
            return self._json({"ok": True})
        return self._json({"blad": "nieznane"}, 404)


def main():
    a = argparse.ArgumentParser(description="Porównywarka sprite'ów SS13/SS14")
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
    print("Porównywarka działa: %s" % adres, flush=True)
    if not arg.bez_przegladarki:
        webbrowser.open(adres)
    try:
        serwer.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
