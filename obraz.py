"""Podpisy wyglądu sprite'ów do porównywania między repozytoriami.

Dla pierwszej klatki (kierunek południe) liczy:
  h – skrót przyciętych pikseli: równy tylko dla identycznego obrazka,
  v – 64-bitowy dHash jasności (obrazek na szarym tle, 9×8): podobny przy drobnych zmianach,
  m – 64-bitowa sylwetka (kanał alfa, 8×8): kształt niezależny od koloru,
  c – średni kolor nieprzezroczystych pikseli (#rrggbb),
  r – rozmiar przyciętego obrazka [szer, wys].
"""

import hashlib
from collections import OrderedDict

import numpy as np
from PIL import Image

_pliki = OrderedDict()
PROG_ALFA = 16


def otworz(sciezka):
    """Obrazek RGBA z pamięci podręcznej (ostatnie 48 plików)."""
    if sciezka in _pliki:
        _pliki.move_to_end(sciezka)
        return _pliki[sciezka]
    try:
        with Image.open(sciezka) as im:
            obraz = np.asarray(im.convert("RGBA"))
    except (OSError, ValueError, Image.DecompressionBombError):
        obraz = None
    _pliki[sciezka] = obraz
    if len(_pliki) > 48:
        _pliki.popitem(last=False)
    return obraz


def wycinek(obraz, n, szer, wys):
    """Klatka numer n z siatki szer×wys (wierszami)."""
    if obraz is None:
        return None
    kolumny = max(1, obraz.shape[1] // szer)
    x, y = (n % kolumny) * szer, (n // kolumny) * wys
    if y + wys > obraz.shape[0] or x + szer > obraz.shape[1]:
        return None
    return obraz[y:y + wys, x:x + szer]


def zloz(warstwy):
    """Nakłada warstwy RGBA (numpy, ten sam rozmiar albo wyśrodkowane u dołu) z opcjonalnym kolorem."""
    if not warstwy:
        return None
    wys = max(w.shape[0] for w, _ in warstwy)
    szer = max(w.shape[1] for w, _ in warstwy)
    wynik = np.zeros((wys, szer, 4), dtype=np.float32)
    for w, kolor in warstwy:
        w = w.astype(np.float32) / 255
        if kolor:
            k = kolor.lstrip("#")
            if len(k) in (6, 8):
                try:
                    mnoz = np.array([int(k[i:i + 2], 16) / 255 for i in (0, 2, 4)] + [int(k[6:8], 16) / 255 if len(k) == 8 else 1.0], dtype=np.float32)
                    w = w * mnoz
                except ValueError:
                    pass
        y0, x0 = wys - w.shape[0], (szer - w.shape[1]) // 2
        cel = wynik[y0:y0 + w.shape[0], x0:x0 + w.shape[1]]
        a = w[..., 3:4]
        cel[..., :3] = w[..., :3] * a + cel[..., :3] * (1 - a)
        cel[..., 3:4] = a + cel[..., 3:4] * (1 - a)
    return (wynik * 255).round().astype(np.uint8)


def _bity(tablica):
    wartosc = 0
    for b in tablica.flatten():
        wartosc = (wartosc << 1) | int(bool(b))
    return "%016x" % wartosc


def podpis(klatka):
    if klatka is None:
        return None
    alfa = klatka[..., 3]
    maska = alfa > PROG_ALFA
    if not maska.any():
        return None
    ys = np.where(maska.any(axis=1))[0]
    xs = np.where(maska.any(axis=0))[0]
    c = klatka[ys[0]:ys[-1] + 1, xs[0]:xs[-1] + 1].copy()
    c[c[..., 3] <= PROG_ALFA] = 0
    h = hashlib.sha1(("%dx%d" % c.shape[:2]).encode() + c.tobytes()).hexdigest()[:12]
    a = c[..., 3:4].astype(np.float32) / 255
    rgb = c[..., :3].astype(np.float32)
    jasnosc = ((rgb * a + 128 * (1 - a)) @ np.array([0.299, 0.587, 0.114], dtype=np.float32)).astype(np.uint8)
    d = np.asarray(Image.fromarray(jasnosc).resize((9, 8), Image.BILINEAR), dtype=np.int16)
    v = _bity(d[:, 1:] > d[:, :-1])
    s = np.asarray(Image.fromarray((c[..., 3] > PROG_ALFA).astype(np.uint8) * 255).resize((8, 8), Image.BILINEAR))
    m = _bity(s > 96)
    widoczne = c[..., 3] > PROG_ALFA
    srednia = c[..., :3][widoczne].mean(axis=0)
    return {
        "h": h, "v": v, "m": m,
        "c": "#%02x%02x%02x" % tuple(int(x) for x in srednia),
        "r": [int(c.shape[1]), int(c.shape[0])],
    }
