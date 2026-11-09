"""Indeks ikon HUD: umiejętności i akcje, przyciski stylów HUD, alerty, menu radialne, znaczniki.

SS13: wszystkie stany z plików .dmi, których ścieżka wygląda na interfejs (hud, actions,
screen_*, radial, alert, ui…). SS14: wszystkie stany z katalogów .rsi w Resources/Textures/Interface.
Dla każdego stanu liczony jest podpis wyglądu (obraz.py), żeby porównać ikony między repo.
"""

import json
import os
import re

import dzwieki
import indeks_ss13
import obraz

# ścieżki SS13 (małe litery), które uznajemy za interfejs
_HUD_SS13 = re.compile(r"(^|/)(hud|huds|actions?|ui|ui_icons|abilit\w*)/|/(screen|hud_|radial|actions?|spell_buttons|genetics_powers|alert)[^/]*\.dmi$")
_POMIJANE = ("/en/", "mouse_pointer", "fullscreen", "widescreen", "map_backgrounds", "screen_full", "screen_fog",
             "minimap", "computer_screens", "pic_in_pic", "screen_drag", "character_editor")
MAKS_ROZMIAR = 96

KATEGORIE = [
    ("radial", "Menu radialne"),
    ("alerty", "Alerty"),
    ("emotki", "Emotki"),
    ("znaczniki", "Znaczniki HUD (ochrona, medycyna, antagoniści)"),
    ("akcje", "Umiejętności i akcje"),
    ("przyciski", "Przyciski i style HUD"),
    ("inne", "Inne"),
]

_SS14_FOLDERY = {
    "actions": "akcje", "adminactions": "akcje", "verbicons": "akcje",
    "alerts": "alerty", "radial": "radial", "emotes": "emotki",
    "default": "przyciski", "minimalist": "przyciski", "retro": "przyciski", "plasmafire": "przyciski",
    "slimecore": "przyciski", "clockwork": "przyciski", "ashen": "przyciski", "inventory": "przyciski",
    "itemstatus": "przyciski", "nano": "przyciski",
}


def kategoria_ss13(sciezka):
    s = sciezka.lower()
    nazwa = s.rsplit("/", 1)[-1]
    if "radial" in nazwa:
        return "radial"
    if "alert" in nazwa:
        return "alerty"
    if "emote" in nazwa:
        return "emotki"
    if re.search(r"sechud|medhud|antag|diaghud|hydrohud|malfhud|job|implants|/huds/|hud\.dmi$|hud_misc", s):
        return "znaczniki"
    if re.search(r"action|abilit|spell|genetics_powers|perks", s):
        return "akcje"
    if re.search(r"screen|hud_|/hud/", s):
        return "przyciski"
    return "inne"


def czy_hud_ss13(sciezka):
    s = sciezka.lower().replace("\\", "/")
    return s.endswith(".dmi") and _HUD_SS13.search(s) is not None and not any(p in s for p in _POMIJANE)


def _wpis(plik, stan, kat, grupa, nazwa, klatka, dirs, klatki):
    if klatka is None or klatka.shape[0] > MAKS_ROZMIAR or klatka.shape[1] > MAKS_ROZMIAR:
        return None
    pod = obraz.podpis(klatka)
    if not pod:
        return None
    w = {"f": plik, "s": stan, "n": nazwa, "k": kat, "g": grupa}
    w.update(pod)
    if dirs > 1:
        w["d"] = dirs
    if klatki > 1:
        w["a"] = klatki
    return w


def zbuduj(repo, rodzaj, postep=lambda t: None):
    postep("szukam ikon HUD")
    wynik = []
    if rodzaj == "ss14":
        baza = os.path.join(repo, "Resources", "Textures", "Interface")
        for korzen, katalogi, _ in os.walk(baza):
            katalogi.sort()
            for k in list(katalogi):
                if not k.endswith(".rsi"):
                    continue
                rsi = os.path.join(korzen, k)
                wzgl = os.path.relpath(rsi, repo).replace("\\", "/")
                czlony = os.path.relpath(rsi, baza).replace("\\", "/").split("/")
                kat = _SS14_FOLDERY.get(czlony[0].lower(), "inne")
                grupa = czlony[0] if len(czlony) == 1 else czlony[-2]
                try:
                    with open(os.path.join(rsi, "meta.json"), encoding="utf-8-sig") as f:
                        meta = json.load(f)
                except (OSError, ValueError):
                    continue
                szer, wys = int((meta.get("size") or {}).get("x", 32)), int((meta.get("size") or {}).get("y", 32))
                stem = k[:-4]
                for st in meta.get("states", []):
                    nazwa_stanu = st.get("name")
                    if not isinstance(nazwa_stanu, str):
                        continue
                    klatka = obraz.wycinek(obraz.otworz(os.path.join(rsi, nazwa_stanu + ".png")), 0, szer, wys)
                    klatki = len((st.get("delays") or [[1]])[0])
                    nazwa = stem if nazwa_stanu in ("icon", "base", "") else nazwa_stanu
                    w = _wpis(wzgl, nazwa_stanu, kat, grupa, nazwa, klatka, st.get("directions", 1), klatki)
                    if w:
                        wynik.append(w)
    else:
        pliki = [p for p in dzwieki.pliki_gita(repo) if czy_hud_ss13(p) and os.path.isfile(os.path.join(repo, p))]
        postep("czytam ikony HUD (%d plików)" % len(pliki))
        for plik in sorted(pliki):
            st = indeks_ss13.opis_dmi(os.path.join(repo, plik))
            if not st:
                continue
            obr = obraz.otworz(os.path.join(repo, plik))
            kat = kategoria_ss13(plik)
            grupa = os.path.splitext(plik.rsplit("/", 1)[-1])[0]
            for nazwa_stanu, (indeks, dirs, klatki) in st.items():
                klatka = obraz.wycinek(obr, indeks, st.szer, st.wys)
                nazwa = nazwa_stanu or grupa
                w = _wpis(plik, nazwa_stanu, kat, grupa, nazwa, klatka, dirs, klatki)
                if w:
                    wynik.append(w)
    postep("gotowe")
    return {"ikony": wynik, "kategorie": [{"id": k, "nazwa": n} for k, n in KATEGORIE]}
