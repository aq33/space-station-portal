// Objaśnienia w interfejsie: pasek „co teraz widać” nad tabelą i okno „Jak to działa”.

const el = (tag, wlasc = {}, ...dzieci) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(wlasc)) {
    if (k === "klasa") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
  }
  for (const d of dzieci.flat()) if (d !== null && d !== undefined && d !== false) e.append(d);
  return e;
};

export const OPIS_KRYTERIOW = {
  wyglad: "Wygląd: porównuje pierwszą klatkę sprite'a. Identyczne piksele dają 50 pkt, podobny obrazek (kształt i jasność, z karą za inny kolor) do 32 pkt.",
  nazwa: "Nazwa: ta sama nazwa przedmiotu daje 30 pkt, podobna (co najmniej połowa wspólnych słów) do 24 pkt.",
  opis: "Opis: ten sam opis (desc/description) daje 30 pkt, podobny do 22 pkt. Bazy często kopiują opisy słowo w słowo.",
  sciezka: "Ścieżka: ta sama ścieżka typu daje 40 pkt, także po zmianie nazwy z reguł UpdatePaths (np. food/snacks → food). Wspólne słowa ścieżki lub id dają do 8 pkt.",
};

const TRYBY_DZWIEKOW = {
  wszystkie: () => "Wszystkie dźwięki z widocznych repo. Ten sam dźwięk z różnych repo leży w jednym wierszu. Najpierw szukam identycznego pliku, potem tej samej ścieżki (bez sound/ albo Resources/Audio/), a na końcu tej samej nazwy pliku.",
  nowe: (r) => `Dźwięki z ${r}, których nie ma w żadnym innym widocznym repo: ani identycznego pliku, ani tej samej ścieżki, ani tej samej nazwy pliku. Ukrycie repo na pasku zmienia, z czym porównuję.`,
  rozne: () => "Dźwięki, które są w kilku repo pod tą samą ścieżką albo nazwą pliku, ale plik się różni (inne nagranie, długość albo kodowanie). Żółta kropka to inna wersja niż w pierwszym repo wiersza, zielona to plik identyczny.",
  uzywane: (r) => `Dźwięki z ${r}, do których kod ${r} odwołuje się wprost: 'sound/…' w plikach .dm albo /Audio/… w YAML i C#, także przez soundCollection. Kliknij wiersz, żeby zobaczyć te miejsca.`,
  nieuzywane: (r) => `Dźwięki z ${r}, do których kod nie odwołuje się wprost. Uwaga: plik wybierany ścieżką składaną w kodzie (np. "sound/voice/[name].ogg") też tu trafi. To lista do sprawdzenia, nie do usuwania.`,
  brakujace: (r) => `Miejsca w kodzie ${r}, które odwołują się do pliku dźwięku, którego w repo nie ma: literówka, usunięty albo przeniesiony plik.`,
};

// Jedno-dwa zdania o tym, co teraz widać.
export function opisWidoku(s) {
  const tekst = [];
  if (s.zakladka === "dzwieki") {
    tekst.push(TRYBY_DZWIEKOW[s.tryb]?.(`repo ${s.repoDzwiekow}`) ?? "");
    if (s.kategoria) tekst.push(`Kategoria: ${s.kategoria}${s.podgrupa ? " → " + s.podgrupa : ""} (pierwszy folder w ścieżce dźwięku).`);
    if (s.zapytanie) tekst.push(`Ścieżka pliku musi zawierać wszystkie słowa z „${s.zapytanie}”.`);
  } else {
    const skad = s.zrodlo ? `z repo ${s.zrodlo}` : "ze wszystkich repo (kolejno, bez powtórzeń)";
    let co = `Wiersze to przedmioty ${skad}`;
    if (s.kategoria) co += `, kategoria ${s.kategoria}${s.podgrupa ? " → " + s.podgrupa : ""}`;
    if (s.zapytanie) co += `, których nazwa albo ścieżka zawiera wszystkie słowa z „${s.zapytanie}”`;
    if (s.tylkoZOdp) co += ", tylko z odpowiednikiem";
    tekst.push(co + ".");
    tekst.push(`W innych kolumnach Portal szuka odpowiednika po: ${s.kryteria.join(", ")}. Zielona kropka to co najmniej 45 pkt (pewne), żółta to 25–44 pkt (możliwe), fioletowa to wybór ręczny.`);
  }
  return tekst.filter(Boolean).join(" ");
}

function sekcja(tytul, ...tresc) {
  return el("section", { klasa: "sekcja-pomocy" }, el("h3", {}, tytul), ...tresc);
}

const p = (...t) => el("p", {}, ...t);
const li = (...t) => el("li", {}, ...t);

export function otworzPomoc(zakladka) {
  const sprite = [
    sekcja("Szukanie",
      p("Wpisz jedno albo kilka słów. Pokazuję przedmioty, których nazwa albo ścieżka typu (w SS14 id prototypu) zawiera wszystkie te słowa, w dowolnej kolejności. Wielkość liter nie ma znaczenia."),
      p("Najpierw idą przedmioty o dokładnie takiej nazwie, potem te, których nazwa zawiera cały wpisany tekst, a na końcu reszta. Można wpisać fragment ścieżki, np. ", el("code", {}, "/obj/item/gun/energy"), " albo ", el("code", {}, "Clothing")),
    ),
    sekcja("Kategorie",
      p("Kolumna po lewej dzieli przedmioty na kategorie wspólne dla SS13 i SS14. W SS13 decyduje ścieżka typu, np. ", el("code", {}, "/obj/item/clothing/head"), ", a w SS14 folder prototypu, np. ", el("code", {}, "Clothing/Head"), ". Wygrywa najdłuższe pasujące dopasowanie, więc apteczka ląduje w Medycynie, a nie w Skrzynkach."),
      p("Podgrupy nad tabelą to kolejny człon ścieżki albo folderu, np. w Nakryciach głowy: helmet, beret, hats. Liczby przy kategoriach uwzględniają wpisany tekst."),
    ),
    sekcja("Jak powstaje wiersz",
      p("Biorę przedmioty z pierwszego repo (albo z repo wybranego w „Widok → Wiersze z”) i dla każdego szukam odpowiednika w pozostałych kolumnach. Potem przechodzę do kolejnych repo i dokładam tylko te przedmioty, które nie trafiły jeszcze do żadnego wiersza jako pewny odpowiednik. Dzięki temu ten sam łom nie pojawia się kilka razy."),
    ),
    sekcja("Dopasowanie: skąd wiadomo, że to „ten sam” przedmiot",
      p("Każdy kandydat z innego repo dostaje punkty za każde włączone kryterium naraz. Wygrywa ten, kto ma najwięcej:"),
      el("ul", {}, ...Object.values(OPIS_KRYTERIOW).map((t) => li(t)), li("Ta sama kategoria daje +4 pkt.")),
      p("Od 45 pkt dopasowanie jest pewne (zielona kropka), od 25 możliwe (żółta). Poniżej 25 komórka zostaje pusta (—). Pewne zwykle znaczy, że pasują co najmniej dwa kryteria, np. nazwa i ścieżka. Sam podobny wygląd albo sama ogólna ścieżka daje najwyżej „możliwe” i bywa mylne."),
      p("Przełączniki „Porównuj po” u góry wyłączają kryteria. Bez wyglądu zostają same teksty i odwrotnie, a tabela od razu się przelicza."),
    ),
    sekcja("Poprawianie",
      p("Kliknij wiersz. Przy każdym repo widać powody i punkty dopasowania, a pod spodem inne propozycje do kliknięcia. „Wskaż inny…” szuka ręcznie, „Brak odpowiednika” zostawia pustą komórkę, a „✓ Dobrze” zapamiętuje trafne dopasowanie."),
      p("Lokalnie poprawki zapisują się w reczne.json. Online zostają w Twojej przeglądarce, a „Pobierz moje poprawki” daje plik do wrzucenia do repo Portalu."),
    ),
  ];
  const dzwieki = [
    sekcja("Szukanie",
      p("Wpisane słowa muszą wystąpić w ścieżce pliku dźwięku (folder i nazwa), np. ", el("code", {}, "airlock"), ", ", el("code", {}, "weapons gunshot"), "."),
    ),
    sekcja("Kategorie",
      p("Kategoria to pierwszy folder po sound/ (SS13) albo Resources/Audio/ (SS14), np. weapons → Broń, voice → Głosy. Podgrupa to kolejny folder. Foldery modularne SS14 (np. _Polonium) są pomijane."),
    ),
    sekcja("Jak powstaje wiersz",
      p("Ten sam dźwięk z różnych repo łączę w jeden wiersz, po kolei:"),
      el("ol", {}, li("identyczna zawartość pliku (skrót SHA-1), nawet przy innej nazwie,"), li("ta sama ścieżka względna, bez wielkości liter i rozszerzenia (np. machines/airlock),"), li("ta sama nazwa pliku w innym folderze.")),
      p("Zielona kropka to plik identyczny z pierwszym w wierszu, a żółta to inna wersja (inne nagranie, długość albo kodowanie)."),
    ),
    sekcja("Widoki",
      el("ul", {}, ...Object.entries(TRYBY_DZWIEKOW).map(([k, f]) => li(el("b", {}, { wszystkie: "Wszystkie", nowe: "Nowe", rozne: "Różne wersje", uzywane: "Używane", nieuzywane: "Nieużywane", brakujace: "Brakujące pliki" }[k] + ": "), f("wybranego repo")))),
    ),
    sekcja("Gdzie używa",
      p("Portal szuka w kodzie dosłownych ścieżek: 'sound/…ogg' w plikach .dm, a w SS14 /Audio/… w prototypach YAML i kodzie C#. Użycie kolekcji soundCollection liczy się każdemu jej plikowi. Linie z komentarzem są pomijane."),
      p("Ścieżek składanych w kodzie (np. \"sound/voice/[name].ogg\" albo pick() z listy budowanej w pętli) Portal nie widzi. Taki plik może więc wyglądać na nieużywany."),
    ),
  ];
  const okno = el("dialog", { klasa: "okno-pomocy" }, el("div", { klasa: "okno" },
    el("h2", {}, zakladka === "dzwieki" ? "Jak działa porównywanie dźwięków" : "Jak działa porównywanie sprite'ów"),
    ...(zakladka === "dzwieki" ? dzwieki : sprite),
    el("div", { klasa: "przyciski" }, el("button", { klasa: "przycisk", onclick: () => okno.close() }, "Zamknij"))));
  okno.addEventListener("close", () => okno.remove());
  document.body.append(okno);
  okno.showModal();
}
