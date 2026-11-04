"""Reguły zmian ścieżek typów z tools/UpdatePaths/Scripts (tg, Paradise i pochodne).

Każdy skrypt UpdatePaths opisuje, jak PR przemianował typy, np.
  /obj/item/food/snacks/@SUBTYPES : /obj/item/food/@SUBTYPES{@OLD}
Zbieramy reguły bez warunków na zmienne, żeby przeglądarka mogła sprowadzić ścieżki
ze starszych baz do nowszych nazw i porównać je między repozytoriami.
"""

import os
import re

_SKRYPTY = os.path.join("tools", "UpdatePaths", "Scripts")
_NAWIASY = re.compile(r"\{[^}]*\}")
_SCIEZKA = re.compile(r"^/[\w/]+$")


def _numer(nazwa):
    m = re.match(r"(\d+)", nazwa)
    return int(m.group(1)) if m else 0


def _korzen(s):
    return "/".join(s.split("/")[:3])


def reguly_repo(repo):
    """Lista (numer PR, lewa, prawa, czy_podtypy) z jednego repozytorium."""
    katalog = os.path.join(repo, _SKRYPTY)
    wynik = []
    if not os.path.isdir(katalog):
        return wynik
    for nazwa in os.listdir(katalog):
        if not nazwa.endswith(".txt"):
            continue
        try:
            with open(os.path.join(katalog, nazwa), encoding="utf-8", errors="replace") as f:
                linie = f.read().splitlines()
        except OSError:
            continue
        for linia in linie:
            linia = linia.strip()
            if not linia or linia.startswith("#") or " : " not in linia:
                continue
            lewa, prawa = linia.split(" : ", 1)
            lewa = lewa.strip()
            if "{" in lewa:   # reguła tylko dla obiektów z daną zmienną – pomijamy
                continue
            wyjscia = [_NAWIASY.sub("", w).strip() for w in prawa.split(",")]
            podtypy = lewa.endswith("/@SUBTYPES")
            lewa = lewa[:-len("/@SUBTYPES")] if podtypy else lewa
            if not _SCIEZKA.match(lewa):
                continue
            cel = None
            for w in wyjscia:
                w2 = w[:-len("/@SUBTYPES")] if w.endswith("/@SUBTYPES") else w
                if _SCIEZKA.match(w2) and _korzen(w2) == _korzen(lewa):
                    cel = w2
                    break
            if cel and cel != lewa:
                wynik.append((_numer(nazwa), lewa, cel, podtypy))
    return wynik


def zbierz(repozytoria):
    """Złączone reguły: {"dokladne": {stara: nowa}, "podtypy": {stara: nowa}} w kolejności PR."""
    wszystkie = []
    for r in repozytoria:
        wszystkie.extend(reguly_repo(r))
    wszystkie.sort(key=lambda x: x[0])
    dokladne, podtypy = {}, {}
    for _, lewa, prawa, pod in wszystkie:
        (podtypy if pod else dokladne)[lewa] = prawa
    return {"dokladne": dokladne, "podtypy": podtypy}
