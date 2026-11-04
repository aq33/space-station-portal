# Space Station Portal

Strona do porównywania serwerów Space Station 13 i 14 między sobą:

- **Sprite'y** – ten sam przedmiot z kilku repozytoriów obok siebie, z animacją, w rękach i na postaci.
- **Dźwięki** – te same dźwięki w różnych repo, nowe dźwięki danego serwera i miejsca w kodzie, gdzie ich używa.

Działa z repo SS13 (BYOND: kod DM, `.dmi`, `sound/`) i SS14 (RobustToolbox: prototypy YAML, `.rsi`, `Resources/Audio`).

## Z linka (bez instalowania)

**https://aq33.github.io/space-station-portal/**

Wersja online porównuje repo wpisane w [`strona.json`](strona.json): Aquilę, tg, Paradise, Goona, Polonium i Yogstation.
Workflow `.github/workflows/strona.yml` co 6 godzin pobiera ich najnowsze commity, buduje indeksy i publikuje stronę.
Sprite'y i dźwięki strona czyta prosto z GitHuba z tych samych commitów.

Różnice względem wersji lokalnej:
- lista repo jest stała (żeby dodać repo, dopisz je do `strona.json`),
- ręczne poprawki dopasowań zapisują się w przeglądarce. „Pobierz moje poprawki” daje plik `reczne.json`, który można wrzucić do tego repo. Wtedy zobaczą je wszyscy.

## Uruchomienie lokalne

Wersja lokalna pozwala dodawać własne repo, gałęzie i niezacommitowane zmiany.

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
  Portal zrobi rzadki klon do folderu `repo/` z kodem, grafiką i dźwiękami (bez map, tgui i narzędzi).
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

## Dźwięki

Zakładka **Dźwięki** u góry. Wiersz to jeden dźwięk, kolumna to repo. ▶ odtwarza plik, pod spodem jest długość i liczba użyć w kodzie.
Kliknięcie wiersza pokazuje odtwarzacz, kształt fali, licencję (SS14: `attributions.yml`) i listę miejsc użycia.
Każde miejsce to link do pliku i linii na GitHubie.

Lista „Wszystkie dźwięki” pozwala zawęzić widok:

| Widok | Co pokazuje |
|---|---|
| Nowe – tylko w jednym repo | dźwięki, których nie ma w żadnym innym widocznym repo |
| Różne wersje tego samego | ta sama ścieżka albo nazwa pliku, ale inna zawartość |
| Używane / nieużywane przez kod | czy kod wybranego repo odwołuje się do pliku |
| Brakujące pliki | kod odwołuje się do pliku, którego w repo nie ma |

Dźwięki łączą się w wiersz, gdy mają identyczną zawartość (skrót pliku), tę samą ścieżkę po zdjęciu `sound/` albo `Resources/Audio/`, albo tę samą nazwę pliku.
Kropka w rogu: zielona to identyczny plik, żółta to inna wersja.
Użycia to dosłowne ścieżki w kodzie: `'sound/...'` w `.dm`, a w SS14 `/Audio/...` w YAML i C#. Użycie kolekcji `soundCollection` liczy się każdemu jej plikowi.
Ścieżek składanych w kodzie (np. `"sound/voice/[name].ogg"`) Portal nie widzi, więc taki plik może wyglądać na nieużywany.

## Ograniczenia

- Parser DM jest przybliżony (ten sam co w ss13-edytor). Sprite'y składane w kodzie (GAGS bez gotowych ikon map, nakładki z `update_overlays`) nie są odtwarzane.
- „Na postaci” w SS13 bierze `worn_icon`/`wear_image_icon` albo szuka stanu w plikach `icons/mob` danego slotu.
- W SS14 kolor warstw (`color`) jest nakładany mnożeniem. Warstwy ukryte (`visible: false`) są pomijane.
- Samo podobieństwo wyglądu albo sama ogólna ścieżka (np. `/obj/item/food/snacks`) dają tylko „możliwe” i bywają mylne.
