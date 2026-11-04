# Porównywarka sprite'ów SS13/SS14

Strona w przeglądarce, która pokazuje obok siebie sprite'y tego samego przedmiotu z kilku repozytoriów.
Działa z repo SS13 (BYOND: kod DM + `.dmi`) i SS14 (RobustToolbox: prototypy YAML + `.rsi`).
Wszystko dzieje się lokalnie, nic nie jest wysyłane do internetu.

## Uruchomienie

Potrzebny jest Python 3.10+ i PyYAML (`pip install pyyaml`, tylko dla repo SS14).

```
uruchom.bat
```

Serwer nasłuchuje na `127.0.0.1:8615` i sam otwiera przeglądarkę.
Repo dodaje się przyciskiem **+ Dodaj repo** (podpowiada foldery obok tego projektu, np. z Pulpitu).
Lista repo jest w `repozytoria.json`, a indeksy w `dane/`.

Pierwszy odczyt repo trwa 20–60 s. Potem indeks jest brany z dysku, dopóki nie zmieni się commit repo.
Zmiany niezacommitowane wczytuje przycisk ↻ na kafelku repo.

## Co pokazuje

- Lista po lewej: sprite'y z repo wzorcowego, z wyszukiwaniem po nazwie i ścieżce, filtrem kategorii i liczbą odpowiedników w innych repo (`3/4`).
- Karty po prawej: ten sam przedmiot w każdym widocznym repo, w tej samej skali, z animacją.
  Widoki: ikona, w rękach, na postaci. Kierunki S/N/E/W albo wszystkie naraz. Cztery tła.
- „Stany pliku” pokazuje wszystkie stany z tego samego `.dmi`/`.rsi`, np. warianty i animacje.
- Kliknięcie ścieżki kopiuje ją do schowka. W SS14 widać licencję i autorów z `meta.json`.
- Kliknięcie kafelka repo ukrywa lub pokazuje jego kolumnę. Strzałki ◀ ▶ zmieniają kolejność.
- Adres strony (`#w=…&p=…`) wskazuje wybrany przedmiot, więc można go zapisać jako zakładkę.

## Jak szuka „tego samego przedmiotu”

Po kolei:

1. Ta sama ścieżka typu (SS13↔SS13). Człony `/weapon` i `/device` ze starszych baz są pomijane, więc `/obj/item/weapon/crowbar` = `/obj/item/crowbar`.
2. Ta sama nazwa (`name`). Gdy pasuje kilka, wygrywa ta sama kategoria i najwięcej wspólnych słów w ścieżce/id.
3. Ten sam identyfikator: ostatni człon ścieżki SS13 albo id prototypu SS14.
4. Podobna nazwa (co najmniej 50% wspólnych słów) w tej samej kategorii. Oznaczona na żółto.

Złe dopasowanie poprawia się przyciskiem **Zmień** na karcie (albo „Brak odpowiednika”).
Ręczne wybory zapamiętuje przeglądarka.

## Ograniczenia

- Parser DM jest przybliżony (ten sam co w ss13-edytor). Sprite'y składane w kodzie (GAGS bez gotowych ikon map, nakładki z `update_overlays`) nie są odtwarzane.
- „Na postaci” w SS13 bierze `worn_icon` albo szuka stanu w plikach `icons/mob` danego slotu (gloves → `hands.dmi` itd.).
- W SS14 kolor warstw (`color`) jest nakładany mnożeniem. Warstwy ukryte (`visible: false`) i stany zależne od wizualizerów są pomijane.
- Klony rzadkie (bez folderu `icons`) nie dają się dodać, bo nie mają sprite'ów.
