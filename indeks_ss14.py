"""Indeks sprite'ów repozytorium SS14 (RobustToolbox).

Czyta prototypy encji z Resources/Prototypes (YAML), rozwija dziedziczenie
(parent, także lista rodziców) i składa sprite z komponentów Icon/Sprite.
Stany sprawdza w meta.json katalogów .rsi w Resources/Textures.
"""

import json
import os

import yaml

try:
    Ladowarka = yaml.CSafeLoader
except AttributeError:   # PyYAML bez libyaml
    Ladowarka = yaml.SafeLoader


class Loader(Ladowarka):
    pass


def _znacznik(loader, sufiks, wezel):
    """Znaczniki typu !type:Coś zamieniamy na zwykłe wartości."""
    if isinstance(wezel, yaml.MappingNode):
        return loader.construct_mapping(wezel, deep=True)
    if isinstance(wezel, yaml.SequenceNode):
        return loader.construct_sequence(wezel, deep=True)
    return loader.construct_scalar(wezel)


Loader.add_multi_constructor("!", _znacznik)

# Slot ubrania -> przyrostek stanu „equipped-…” w RSI.
SLOTY = {
    "head": "HELMET", "gloves": "HAND", "back": "BACKPACK", "innerclothing": "INNERCLOTHING",
    "outerclothing": "OUTERCLOTHING", "eyes": "EYES", "mask": "MASK", "neck": "NECK",
    "ears": "EARS", "belt": "BELT", "feet": "FEET", "idcard": "IDCARD", "suitstorage": "SUITSTORAGE",
}


def kategoria(plik):
    p = plik.replace("\\", "/")
    i = p.find("Entities/")
    p = p[i + 9:] if i >= 0 else p
    if p.startswith("Clothing/"):
        return "ubrania"
    if p.startswith("Objects/Weapons/"):
        return "bronie"
    if p.startswith(("Objects/Consumable/Food/", "Objects/Consumable/Drinks/")):
        return "jedzenie"
    if p.startswith("Objects/"):
        return "przedmioty"
    if p.startswith("Structures/Machines/"):
        return "maszyny"
    if p.startswith(("Structures/", "Stations/")):
        return "struktury"
    if p.startswith("Mobs/"):
        return "moby"
    if p.startswith("Tiles/"):
        return "podlogi"
    return "inne"


def zbuduj(repo, postep=lambda t: None):
    zasoby = os.path.join(repo, "Resources")
    prototypy = os.path.join(zasoby, "Prototypes")
    tekstury = os.path.join(zasoby, "Textures")

    postep("czytam prototypy YAML")
    encje = {}
    for korzen, katalogi, pliki in os.walk(prototypy):
        katalogi.sort()
        for p in sorted(pliki):
            if not p.endswith((".yml", ".yaml")):
                continue
            sciezka = os.path.join(korzen, p)
            try:
                with open(sciezka, encoding="utf-8-sig") as f:
                    tekst = f.read()
            except OSError:
                continue
            if "type: entity" not in tekst:
                continue
            try:
                dok = yaml.load(tekst, Loader=Loader)
            except yaml.YAMLError:
                continue
            if not isinstance(dok, list):
                continue
            wzgledna = os.path.relpath(sciezka, repo).replace("\\", "/")
            for e in dok:
                if isinstance(e, dict) and e.get("type") == "entity" and isinstance(e.get("id"), str):
                    e["_plik"] = wzgledna
                    encje[e["id"]] = e   # późniejszy plik nadpisuje (tak jak przy ładowaniu gry)

    postep("rozwijam dziedziczenie (%d encji)" % len(encje))
    rozwiniete = {}

    def rozwin(ident, glebokosc=0):
        if ident in rozwiniete:
            return rozwiniete[ident]
        e = encje.get(ident)
        if e is None or glebokosc > 40:
            return None
        rozwiniete[ident] = None   # ochrona przed pętlą
        rodzice = e.get("parent") or []
        if isinstance(rodzice, str):
            rodzice = [rodzice]
        wynik = {"name": None, "description": None, "komponenty": {}}
        for r in rodzice:
            pr = rozwin(r, glebokosc + 1)
            if not pr:
                continue
            for k in ("name", "description"):
                if pr[k] is not None:
                    wynik[k] = pr[k]
            for typ, pola in pr["komponenty"].items():
                wynik["komponenty"].setdefault(typ, {}).update(pola)
        for k in ("name", "description"):
            if isinstance(e.get(k), str):
                wynik[k] = e[k]
        for komp in e.get("components") or []:
            if isinstance(komp, dict) and isinstance(komp.get("type"), str):
                pola = {k: v for k, v in komp.items() if k != "type"}
                wynik["komponenty"].setdefault(komp["type"], {}).update(pola)
        rozwiniete[ident] = wynik
        return wynik

    meta = {}

    def stany_rsi(rsi):
        if rsi not in meta:
            try:
                with open(os.path.join(tekstury, rsi, "meta.json"), encoding="utf-8-sig") as f:
                    m = json.load(f)
                meta[rsi] = {s.get("name") for s in m.get("states", []) if isinstance(s, dict)}
            except (OSError, ValueError):
                meta[rsi] = None
        return meta[rsi]

    def norm_rsi(r):
        if not isinstance(r, str):
            return None
        r = r.replace("\\", "/").lstrip("/")
        if r.startswith("Textures/"):
            r = r[9:]
        return r

    def warstwa(rsi, stan, kolor=None):
        rsi = norm_rsi(rsi)
        if not rsi or not isinstance(stan, str):
            return None
        st = stany_rsi(rsi)
        if not st or stan not in st:
            return None
        w = ["Resources/Textures/" + rsi, stan]
        if isinstance(kolor, str) and kolor:
            w.append(kolor)
        return w

    wynik = []
    postep("składam sprite'y")
    for ident, e in encje.items():
        if e.get("abstract"):
            continue
        r = rozwin(ident)
        if not r:
            continue
        k = r["komponenty"]
        sprite = k.get("Sprite") or {}
        warstwy = []
        ikona = k.get("Icon") or {}
        if ikona.get("state"):
            w = warstwa(ikona.get("sprite") or sprite.get("sprite"), ikona.get("state"))
            if w:
                warstwy = [w]
        if not warstwy:
            layers = sprite.get("layers")
            if isinstance(layers, list) and layers:
                for l in layers:
                    if not isinstance(l, dict) or l.get("visible") is False:
                        continue
                    w = warstwa(l.get("sprite") or sprite.get("sprite"), l.get("state"), l.get("color") or sprite.get("color"))
                    if w:
                        warstwy.append(w)
            else:
                w = warstwa(sprite.get("sprite"), sprite.get("state"), sprite.get("color"))
                if w:
                    warstwy = [w]
        if not warstwy:
            continue
        wpis = {
            "id": ident,
            "n": (r["name"] or "").strip(),
            "s": warstwy,
            "k": kategoria(e["_plik"]),
            "f": e["_plik"],
        }
        if r["description"]:
            wpis["d"] = str(r["description"]).strip()
        przedmiot = k.get("Item")
        if isinstance(przedmiot, dict):
            rsi = przedmiot.get("sprite") or sprite.get("sprite")
            pref = przedmiot.get("heldPrefix")
            pref = pref + "-" if isinstance(pref, str) and pref else ""
            l = warstwa(rsi, pref + "inhand-left")
            p = warstwa(rsi, pref + "inhand-right")
            if l:
                wpis["l"] = [l]
            if p:
                wpis["p"] = [p]
        ubranie = k.get("Clothing")
        if isinstance(ubranie, dict):
            rsi = ubranie.get("sprite") or sprite.get("sprite")
            sloty = ubranie.get("slots") or []
            if isinstance(sloty, str):
                sloty = [sloty]
            for slot in sloty:
                przyrostek = SLOTY.get(str(slot).lower())
                w = przyrostek and warstwa(rsi, "equipped-" + przyrostek)
                if w:
                    wpis["w"] = [w]
                    break
        wynik.append(wpis)
    wynik.sort(key=lambda w: w["id"])
    postep("gotowe")
    return {"rodzaj": "ss14", "przedmioty": wynik}
