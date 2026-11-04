# Porównywarka sprite'ów SS13/SS14

Strona w przeglądarce, która pokazuje obok siebie sprite'y tego samego przedmiotu z kilku repozytoriów.
Działa z repo SS13 (BYOND: kod DM + `.dmi`) i SS14 (RobustToolbox: prototypy YAML + `.rsi`).
Wszystko dzieje się lokalnie. Do internetu łączy się tylko przy pobieraniu repo z GitHuba.

## Uruchomienie

Potrzebny jest Python 3.10+ z pakietami Pillow, numpy i PyYAML (`pip install pillow numpy pyyaml`) oraz git.

```
uruchom.bat
```

Serwer nasłuchuje na `127.0.0.1:8615` i sam otwiera przeglądarkę.

## Jak się tym posługiwać

1. U góry wpisz, czego szukasz (`crowbar`, `captain`, `/obj/item/gun`).
2. Każdy wiersz tabeli to jeden przedmiot, każda kolumna to jedno repo. Kropka w rogu komórki mówi, jak pewne jest dopasowanie:
   zielona – pewne, żółta – możliwe, fioletowa – wybrane ręcznie. Kreska oznacza, że w tym repo nic nie pasuje.
   Pod sprite'em pojawia się nazwa, jeśli w tym repo przedmiot nazywa się inaczej.
3. Kliknij wiersz, żeby zobaczyć wszystkie wersje w powiększeniu: z animacją, w rękach, na postaci i we wszystkich kierunkach.
   Strzałki ↑ ↓ przechodzą do sąsiednich wierszy.
4. Złe dopasowanie poprawiasz w szczegółach: kliknij jedną z „Innych propozycji”, „Wskaż inny…” albo „Brak odpowiednika”.
   „✓ Dobrze” zapamiętuje trafne dopasowanie na stałe. Poprawki trafiają do pliku `reczne.json` w tym folderze.

„Porównuj po” włącza i wyłącza kryteria: wygląd, nazwa, opis, ścieżka. Tabela przelicza się od razu.
W menu „Widok” jest wybór repo, z którego biorą się wiersze, rozmiar sprite'ów, tło i opcja „tylko przedmioty z odpowiednikiem”.
Kliknięcie repo na pasku ukrywa jego kolumnę. Menu `⋯` w nagłówku kolumny: przesuwanie, zmiana nazwy, ponowny odczyt, usunięcie.

## Dodawanie repo

Przycisk **+ Dodaj repo**:

- **Z GitHuba**: wklej link, np. `https://github.com/tgstation/tgstation` albo `…/tree/nazwa-gałęzi`.
  Porównywarka zrobi rzadki klon do folderu `repo/` z samym kodem i grafiką (bez dźwięków, map i tgui).
  Potem „Aktualizuj z GitHuba” w menu kolumny pobiera najnowszy commit.
- **Z dysku**: „Wybierz folder…” otwiera systemowe okno wyboru. Możesz też wpisać ścieżkę albo kliknąć jedną z podpowiedzi.

Pierwszy odczyt repo trwa od kilkunastu sekund do minuty. Potem indeks jest brany z `dane/`, dopóki nie zmieni się commit.
Niezacommitowane zmiany wczytuje „Przeczytaj od nowa”.

## Jak szuka „tego samego przedmiotu”

Każdy kandydat dostaje punkty za wszystkie włączone kryteria naraz:

| Kryterium | Ile punktów | Skąd |
|---|---|---|
| wygląd | 50 za identyczny obraz, do 32 za podobny | podpis pierwszej klatki: skrót pikseli, dHash jasności, sylwetka, średni kolor (`obraz.py`) |
| nazwa | 30 za taką samą, do 24 za podobną | `name`, bez `\improper` i znaków |
| opis | 30 za taki sam, do 22 za podobny | `desc`, często kopiowany między bazami |
| ścieżka | 40 za tę samą, do 8 za wspólne człony | ścieżka typu sprowadzona regułami UpdatePaths (`sciezki.py`) w obie strony, bez `/weapon` i `/device` |

Do tego +4 za tę samą kategorię. Od 45 punktów dopasowanie jest „pewne”, od 25 „możliwe”.

## Ograniczenia

- Parser DM jest przybliżony (ten sam co w ss13-edytor). Sprite'y składane w kodzie (GAGS bez gotowych ikon map, nakładki z `update_overlays`) nie są odtwarzane.
- „Na postaci” w SS13 bierze `worn_icon`/`wear_image_icon` albo szuka stanu w plikach `icons/mob` danego slotu.
- W SS14 kolor warstw (`color`) jest nakładany mnożeniem. Warstwy ukryte (`visible: false`) są pomijane.
- Samo podobieństwo wyglądu albo sama ogólna ścieżka (np. `/obj/item/food/snacks`) dają tylko „możliwe” i bywają mylne.
