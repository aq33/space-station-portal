"""Buduje wersję online Portalu (GitHub Pages).

Dla każdego repo ze strona.json robi rzadki klon z GitHuba (kod, grafika, dźwięki),
buduje indeksy sprite'ów i dźwięków i zapisuje je jako dane/*.json obok interfejsu z web/.
Sprite'y i dźwięki strona pobiera potem z raw.githubusercontent.com z tego samego commita.

Użycie: python buduj_strone.py [--wyjscie _site] [--robocze klony] [--usun-klony] [--tylko NAZWA ...]
"""

import argparse
import hashlib
import json
import os
import shutil
import sys
import time

import dzwieki
import indeks_ss13
import indeks_ss14
import sciezki
import serwer

TUTAJ = os.path.dirname(os.path.abspath(__file__))


def klonuj(url, cel, galaz=None):
    if os.path.isdir(os.path.join(cel, ".git")):
        serwer.git(["-C", cel, "fetch", "--depth", "1", "--filter=blob:none", "origin"])
        serwer.git(["-C", cel, "reset", "--hard", "FETCH_HEAD"])
        return
    argumenty = ["clone", "--depth", "1", "--filter=blob:none", "--no-checkout"]
    if galaz:
        argumenty += ["--branch", galaz]
    serwer.git(argumenty + [url + ".git", cel])
    pliki = serwer.git(["-C", cel, "ls-tree", "--name-only", "HEAD"]).split()
    wzorce = serwer.WZORCE_SS13 if any(p.lower().endswith(".dme") for p in pliki) else serwer.WZORCE_SS14
    serwer.git(["-C", cel, "sparse-checkout", "set", "--no-cone", *wzorce])
    serwer.git(["-C", cel, "checkout"])


def zapisz(sciezka, dane):
    with open(sciezka, "w", encoding="utf-8", newline="\n") as f:
        json.dump(dane, f, ensure_ascii=False, separators=(",", ":"))


def main():
    a = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    a.add_argument("--wyjscie", default=os.path.join(TUTAJ, "_site"))
    a.add_argument("--robocze", default=os.path.join(TUTAJ, "klony"))
    a.add_argument("--usun-klony", action="store_true", help="usuń klon po zbudowaniu indeksu (mało miejsca w CI)")
    a.add_argument("--tylko", nargs="*", help="zbuduj tylko te repo (nazwy ze strona.json)")
    arg = a.parse_args()

    with open(os.path.join(TUTAJ, "strona.json"), encoding="utf-8") as f:
        konfiguracja = json.load(f)
    if os.path.isdir(arg.wyjscie):
        shutil.rmtree(arg.wyjscie)
    shutil.copytree(os.path.join(TUTAJ, "web"), arg.wyjscie)
    dane_dir = os.path.join(arg.wyjscie, "dane")
    os.makedirs(dane_dir, exist_ok=True)
    os.makedirs(arg.robocze, exist_ok=True)
    shutil.copy(os.path.join(TUTAJ, "reczne.json"), os.path.join(dane_dir, "reczne.json"))

    repa = []
    reguly = []
    bledy = []
    for wpis in konfiguracja["repa"]:
        if arg.tylko and wpis["nazwa"] not in arg.tylko:
            continue
        t0 = time.time()
        url = wpis["url"].rstrip("/")
        wlasciciel, nazwa = url.split("/")[-2:]
        cel = os.path.join(arg.robocze, "%s__%s" % (wlasciciel, nazwa))
        rid = hashlib.sha1(url.lower().encode()).hexdigest()[:10]
        print("== %s (%s)" % (wpis["nazwa"], url), flush=True)
        try:
            klonuj(url, cel, wpis.get("galaz"))
            rodzaj, dme, blad = serwer.rozpoznaj(cel)
            if blad:
                raise RuntimeError(blad)
            postep = lambda t: print("   " + t, flush=True)   # noqa: E731
            indeks = indeks_ss13.zbuduj(dme, postep) if rodzaj == "ss13" else indeks_ss14.zbuduj(cel, postep)
            wersja = serwer.wersja_git(cel)
            indeks["wersja"] = wersja
            indeks["github"] = url
            zapisz(os.path.join(dane_dir, "indeks-%s.json" % rid), indeks)
            zapisz(os.path.join(dane_dir, "dzwieki-%s.json" % rid), dzwieki.zbuduj(cel, rodzaj, postep))
            if rodzaj == "ss13":
                reguly.extend(sciezki.reguly_repo(cel))
            repa.append({
                "id": rid, "nazwa": wpis["nazwa"], "rodzaj": rodzaj, "github": url,
                "sha": wersja["sha"], "data": wersja["data"], "liczba": len(indeks["przedmioty"]),
            })
            print("   %d sprite'ów, commit %s z %s, %.0f s" % (len(indeks["przedmioty"]), wersja["sha"][:9], wersja["data"], time.time() - t0), flush=True)
        except Exception as e:   # noqa: BLE001 – jedno złe repo nie blokuje reszty
            print("   BŁĄD: %s" % e, flush=True)
            bledy.append(wpis["nazwa"])
        finally:
            if arg.usun_klony and os.path.isdir(cel):
                shutil.rmtree(cel, ignore_errors=True)

    # Reguły zmian ścieżek ze wszystkich repo SS13, w kolejności PR (jak sciezki.zbierz).
    reguly.sort(key=lambda x: x[0])
    dokladne, podtypy = {}, {}
    for _, lewa, prawa, pod in reguly:
        (podtypy if pod else dokladne)[lewa] = prawa
    zapisz(os.path.join(dane_dir, "sciezki.json"), {"dokladne": dokladne, "podtypy": podtypy})
    zapisz(os.path.join(dane_dir, "strona.json"), {"zbudowano": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "repa": repa})
    print("Gotowe: %d repo, błędy: %s" % (len(repa), ", ".join(bledy) or "brak"), flush=True)
    if not repa:
        sys.exit(1)


if __name__ == "__main__":
    main()
