import * as Sprite from "./sprite.js";
import { KRYTERIA, PROG_PEWNE, PROG_MOZLIWE, przygotuj, propozycje, ocen, szukaj, ustawReguly } from "./dopasowanie.js";
import * as Dzwieki from "./dzwieki.js";
import { zrodlo, wykryj, pobierz, wyslij, eksportujPoprawki } from "./zrodlo.js";
import { wczytajKategorie, przypiszSprite, kategorieSprite, kategorieDzwiekow } from "./kategorie.js";

const $ = (s) => document.querySelector(s);
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

// ---------------------------------------------------------------- ustawienia

const ZAPIS = "porownywarka:v2";
const domyslne = {
  kryteria: { wyglad: true, nazwa: true, opis: true, sciezka: true },
  widok: "s", kier: 0, zoom: 5, tlo: "szachownica", anim: true, ukryte: [],
  kategoria: "", podgrupa: "", dzKategoria: "", dzPodgrupa: "", skala: 2, tloTabeli: "szachownica", tylkoZOdp: false, zrodloWierszy: "", zakladka: "sprite",
};
let ust;
try { ust = Object.assign({}, domyslne, JSON.parse(localStorage.getItem(ZAPIS)) || {}); } catch { ust = { ...domyslne }; }
ust.kryteria = Object.assign({}, domyslne.kryteria, ust.kryteria);
function zapisz() {
  try { localStorage.setItem(ZAPIS, JSON.stringify(ust)); } catch { /* prywatne okno */ }
}

const stan = {
  repa: [],
  dane: new Map(),
  ladowane: new Set(),
  reczne: { pary: {} },
  wiersze: [],
  generator: null,
  koniec: false,
  biezacy: -1,
};

const api = { get: pobierz, post: wyslij };

const widoczne = () => stan.repa.filter((r) => !ust.ukryte.includes(r.id) && stan.dane.has(r.id));
const etykieta = (r) => r.rodzaj === "ss14" ? "14" : r.rodzaj === "ss13" ? "13" : "…";

// ---------------------------------------------------------------- repozytoria

async function odswiezRepa() {
  stan.repa = await api.get("/api/repo");
  for (const r of stan.repa) {
    if (r.stan.etap === "gotowe" && !stan.dane.has(r.id) && !stan.ladowane.has(r.id)) wczytajIndeks(r.id);
  }
  for (const id of [...stan.dane.keys()]) if (!stan.repa.some((r) => r.id === id)) stan.dane.delete(id);
  rysujRepa();
  clearTimeout(odswiezRepa._t);
  if (stan.repa.some((r) => !["gotowe", "błąd", "brak"].includes(r.stan.etap))) odswiezRepa._t = setTimeout(odswiezRepa, 1200);
}

async function wczytajIndeks(id) {
  stan.ladowane.add(id);
  rysujRepa();
  try {
    const dane = await api.get(`/api/indeks/${id}`);
    przygotuj(dane);
    for (const p of dane.przedmioty) przypiszSprite(p);
    stan.dane.set(id, dane);
  } catch (e) {
    console.warn("indeks", id, e);
  }
  stan.ladowane.delete(id);
  rysujRepa();
  rysujZrodla();
  przelicz();
}

function rysujRepa() {
  const box = $("#repa");
  box.replaceChildren(el("span", { klasa: "etykieta" }, "Repo:"));
  for (const r of stan.repa) {
    const s = r.stan;
    let opis = null;
    if (stan.ladowane.has(r.id)) opis = "wczytuję…";
    else if (s.etap === "błąd") opis = "błąd";
    else if (s.etap !== "gotowe") opis = s.etap + "…";
    const ukryte = ust.ukryte.includes(r.id);
    const w = stan.dane.get(r.id)?.wersja;
    box.append(el("button", {
      klasa: "repo" + (ukryte ? " ukryte" : "") + (s.etap === "błąd" ? " zle" : "") + (opis ? " pracuje" : ""),
      title: `${r.sciezka}${r.zrodlo ? "\nz " + r.zrodlo : ""}${w ? `\ncommit ${w.sha.slice(0, 9)} z ${w.data}` : ""}${stan.dane.has(r.id) ? `\n${stan.dane.get(r.id).przedmioty.length.toLocaleString("pl")} sprite'ów` : ""}${s.blad ? "\nBłąd: " + s.blad : ""}\n\nKliknij, żeby ukryć lub pokazać kolumnę.`,
      onclick: () => {
        ust.ukryte = ukryte ? ust.ukryte.filter((x) => x !== r.id) : [...ust.ukryte, r.id];
        zapisz(); rysujRepa(); rysujZrodla(); przelicz();
      },
    }, el("span", { klasa: "rodzaj " + r.rodzaj }, etykieta(r)), el("b", {}, r.nazwa), opis ? el("small", {}, opis) : null));
  }
  if (!zrodlo.statyczny) box.append(el("button", { klasa: "przycisk glowny maly", onclick: otworzDodawanie }, "+ Dodaj repo"));
  else {
    box.append(el("button", { klasa: "przycisk glowny maly", onclick: jakDodacOnline }, "+ Dodaj repo"));
    const kiedy = new Date(zrodlo.info.zbudowano).toLocaleString("pl", { dateStyle: "short", timeStyle: "short" });
    box.append(el("span", { klasa: "online", title: "Wersja online odświeża się sama co 6 godzin. Własne repo i gałęzie: uruchom Portal lokalnie (uruchom.bat)." },
      `Wersja online · dane z ${kiedy}`),
      el("button", { klasa: "przycisk maly", title: "Twoje ręczne poprawki zapisują się w tej przeglądarce. Pobierz je jako reczne.json, żeby dodać je do repo Portalu.", onclick: () => eksportujPoprawki(stan.reczne) }, "Pobierz moje poprawki"));
  }
}

// W wersji online repo dopisuje się do strona.json w repo Portalu (CI przebuduje stronę).
function jakDodacOnline() {
  const wlasciciel = location.hostname.split(".")[0];
  const nazwa = location.pathname.split("/").filter(Boolean)[0] || "space-station-portal";
  const repo = `https://github.com/${wlasciciel}/${nazwa}`;
  const okno = el("dialog", {}, el("div", { klasa: "okno" },
    el("h2", {}, "Jak dodać repo do wersji online"),
    el("p", {}, "Wersja online pokazuje repo wpisane w pliku strona.json w repo Portalu. Po każdej zmianie tego pliku GitHub sam przebudowuje stronę (kilka minut)."),
    el("ol", { klasa: "kroki" },
      el("li", {}, "Otwórz ", el("a", { href: `${repo}/edit/main/strona.json`, target: "_blank", rel: "noopener" }, "strona.json do edycji na GitHubie"), "."),
      el("li", {}, "Dopisz na liście nową linię, np.:", el("pre", {}, `{ "nazwa": "Monke", "url": "https://github.com/Monkestation/Monkestation2.0" },`),
        el("small", {}, "Repo musi być publiczne. Można dodać \"galaz\": \"nazwa\", jeśli nie chodzi o domyślną gałąź.")),
      el("li", {}, "Kliknij „Commit changes”. Bez uprawnień do zapisu GitHub sam zaproponuje Pull Request."),
      el("li", {}, "Po kilku minutach nowa kolumna pojawi się na stronie. Postęp widać w ", el("a", { href: `${repo}/actions`, target: "_blank", rel: "noopener" }, "zakładce Actions"), ".")),
    el("h3", {}, "Własne repo bez czekania"),
    el("p", {}, "Wersja lokalna dodaje dowolne repo od razu: link z GitHuba, folder z dysku, własne gałęzie i niezacommitowane zmiany. ",
      el("a", { href: repo, target: "_blank", rel: "noopener" }, "Pobierz Portal"), ", uruchom uruchom.bat i kliknij „+ Dodaj repo”."),
    el("div", { klasa: "przyciski" }, el("button", { klasa: "przycisk", onclick: () => okno.close() }, "Zamknij"))));
  okno.addEventListener("close", () => okno.remove());
  document.body.append(okno);
  okno.showModal();
}

function rysujZrodla() {
  const s = $("#zrodloWierszy");
  if (ust.zrodloWierszy && !widoczne().some((r) => r.id === ust.zrodloWierszy)) ust.zrodloWierszy = "";
  s.replaceChildren(el("option", { value: "" }, "wszystkich repo"),
    ...widoczne().map((r) => el("option", { value: r.id }, r.nazwa)));
  s.value = ust.zrodloWierszy;
}

function pokazMenuRepo(repo, przycisk) {
  const menu = $("#menuRepo");
  const i = stan.repa.indexOf(repo);
  const pozycja = (tekst, fn) => el("button", { onclick: async () => { menu.hidden = true; await fn(); } }, tekst);
  menu.replaceChildren(
    el("div", { klasa: "tytul" }, el("b", {}, repo.nazwa), el("small", {}, repo.zrodlo || repo.sciezka)),
    pozycja("Ukryj kolumnę", () => { ust.ukryte.push(repo.id); zapisz(); rysujRepa(); rysujZrodla(); przelicz(); }),
    repo.github ? el("a", { href: repo.github, target: "_blank", rel: "noopener", klasa: "pozycja" }, "Otwórz repo na GitHubie") : null,
    ...(zrodlo.statyczny ? [] : [
    i > 0 ? pozycja("◀ Przesuń w lewo", () => przesun(i, -1)) : null,
    i < stan.repa.length - 1 ? pozycja("Przesuń w prawo ▶", () => przesun(i, 1)) : null,
    pozycja("Zmień nazwę…", async () => {
      const n = prompt("Nowa nazwa kolumny:", repo.nazwa);
      if (n) { await api.post("/api/zmien", { id: repo.id, nazwa: n }); await odswiezRepa(); przelicz(); }
    }),
    repo.zrodlo
      ? pozycja("Aktualizuj z GitHuba", async () => { await api.post("/api/odswiez", { id: repo.id, aktualizuj: true }); stan.dane.delete(repo.id); await odswiezRepa(); przelicz(); })
      : pozycja("Przeczytaj od nowa", async () => { await api.post("/api/odswiez", { id: repo.id }); stan.dane.delete(repo.id); await odswiezRepa(); przelicz(); }),
    pozycja(repo.zrodlo ? "Usuń (razem z pobranym klonem)" : "Usuń z Portalu", async () => {
      if (!confirm(repo.zrodlo ? `Usunąć „${repo.nazwa}” i pobrany klon z folderu repo/?` : `Usunąć „${repo.nazwa}” z Portalu? Pliki repo zostają na dysku.`)) return;
      await api.post("/api/usun", { id: repo.id });
      stan.dane.delete(repo.id);
      await odswiezRepa(); rysujZrodla(); przelicz();
    }),
    ]),
  );
  const r = przycisk.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 300))}px`;
  menu.style.top = `${r.bottom + 4}px`;
  menu.hidden = false;
}
document.addEventListener("click", (e) => {
  if (!$("#menuRepo").hidden && !e.target.closest("#menuRepo, .menuRepo")) $("#menuRepo").hidden = true;
  if ($("#opcje").open && !e.target.closest("#opcje")) $("#opcje").open = false;
});

async function przesun(i, o) {
  const k = stan.repa.map((r) => r.id);
  [k[i], k[i + o]] = [k[i + o], k[i]];
  await api.post("/api/zmien", { kolejnosc: k });
  await odswiezRepa();
  rysujZrodla();
  przelicz();
}

// ---------------------------------------------------------------- dodawanie repo

async function otworzDodawanie() {
  $("#bladRepo").textContent = "";
  const box = $("#propozycje");
  box.replaceChildren();
  $("#oknoRepo").showModal();
  const prop = await api.get("/api/propozycje");
  if (prop.length) box.append(el("small", {}, "Znalezione obok tego projektu (kliknij, żeby wpisać):"));
  for (const p of prop) {
    box.append(el("button", { type: "button", klasa: "propozycja", onclick: () => { $("#sciezkaRepo").value = p.sciezka; $("#nazwaRepo").value ||= p.nazwa; } },
      el("span", { klasa: "rodzaj " + p.rodzaj }, p.rodzaj === "ss14" ? "14" : "13"), p.nazwa));
  }
}

async function dodaj(url, dane) {
  $("#bladRepo").textContent = "";
  try {
    await api.post(url, { ...dane, nazwa: $("#nazwaRepo").value });
    $("#urlRepo").value = ""; $("#sciezkaRepo").value = ""; $("#nazwaRepo").value = "";
    $("#oknoRepo").close();
    odswiezRepa();
  } catch (err) {
    $("#bladRepo").textContent = err.message;
  }
}
$("#pobierzRepo").addEventListener("click", (e) => { e.preventDefault(); dodaj("/api/klonuj", { url: $("#urlRepo").value }); });
$("#zatwierdzRepo").addEventListener("click", (e) => { e.preventDefault(); dodaj("/api/repo", { sciezka: $("#sciezkaRepo").value }); });
$("#wybierzFolder").addEventListener("click", async () => {
  $("#bladRepo").textContent = "Otwieram okno wyboru folderu (może się schować pod przeglądarką)…";
  try {
    const { sciezka } = await api.post("/api/wybierz-folder", {});
    $("#bladRepo").textContent = "";
    if (sciezka) $("#sciezkaRepo").value = sciezka;
  } catch (err) {
    $("#bladRepo").textContent = err.message;
  }
});

// ---------------------------------------------------------------- ręczne poprawki

// Repo w poprawkach nazywamy „właściciel/repo” z GitHuba, żeby te same poprawki działały
// lokalnie i online (identyfikatory repo różnią się między komputerami).
function staly(repoId) {
  const r = stan.repa.find((x) => x.id === repoId);
  return r?.github ? r.github.replace("https://github.com/", "") : repoId;
}
const klucz = (repoId, p) => `${staly(repoId)}|${p.id}`;

function reczny(repoId, p, celId) {
  const r = stan.reczne.pary[klucz(repoId, p)];
  const c = staly(celId);
  if (!r || !(c in r)) return undefined;
  if (r[c] === null) return null;
  return stan.dane.get(celId)?.m.poId.get(r[c]) ?? undefined;
}

// pB: przedmiot, null = „brak odpowiednika”, undefined = wróć do automatu. Pary zapisujemy w obie strony.
async function ustawReczny(repoA, pA, repoB, pB) {
  const pary = stan.reczne.pary;
  const kA = klucz(repoA, pA);
  const sA = staly(repoA), sB = staly(repoB);
  const stary = pary[kA]?.[sB];
  if (stary) {
    const kS = `${sB}|${stary}`;
    if (pary[kS]) { delete pary[kS][sA]; if (!Object.keys(pary[kS]).length) delete pary[kS]; }
  }
  if (pB === undefined) { if (pary[kA]) delete pary[kA][sB]; }
  else {
    (pary[kA] ||= {})[sB] = pB ? pB.id : null;
    if (pB) (pary[klucz(repoB, pB)] ||= {})[sA] = pA.id;
  }
  if (pary[kA] && !Object.keys(pary[kA]).length) delete pary[kA];
  await api.post("/api/reczne", stan.reczne);
}

// ---------------------------------------------------------------- wiersze

// Komórka: najlepszy odpowiednik wzorca w danym repo (ręczny wybór ma pierwszeństwo).
function komorka(repoWzorca, wzor, repoId) {
  if (repoId === repoWzorca) return { p: wzor, pkt: 100, powody: ["wzorzec wiersza"], jak: "wzor" };
  const r = reczny(repoWzorca, wzor, repoId);
  if (r === null) return { p: null, jak: "brak-recznie" };
  if (r) return { p: r, pkt: 100, powody: ["wybrany ręcznie"], jak: "reczne" };
  const [n] = propozycje(wzor, stan.dane.get(repoId), ust.kryteria, 1);
  if (!n || n.pkt < PROG_MOZLIWE) return { p: null, jak: "brak" };
  return { ...n, jak: n.pkt >= PROG_PEWNE ? "pewne" : "mozliwe" };
}

function* generujWiersze() {
  const repa = widoczne();
  const zrodla = ust.zrodloWierszy ? repa.filter((r) => r.id === ust.zrodloWierszy) : repa;
  const zapytanie = $("#szukaj").value;
  const uzyte = new Set();
  for (const zr of zrodla) {
    for (const p of szukaj(stan.dane.get(zr.id).przedmioty, zapytanie, "")) {
      if (uzyte.has(p)) continue;
      if (ust.kategoria && p.kat !== ust.kategoria) continue;
      if (ust.podgrupa && p.pod !== ust.podgrupa) continue;
      uzyte.add(p);
      const komorki = {};
      let ile = 0;
      for (const r of repa) {
        const k = komorka(zr.id, p, r.id);
        komorki[r.id] = k;
        if (r.id !== zr.id && k.p) {
          ile++;
          // pewnie dopasowany przedmiot nie dostaje już własnego wiersza
          if (k.jak === "pewne" || k.jak === "reczne") uzyte.add(k.p);
        }
      }
      if (ust.tylkoZOdp && !ile) continue;
      yield { zrodlo: zr.id, p, komorki, ile };
    }
  }
}

// ---------------------------------------------------------------- kategorie (kolumna po lewej)

function liczSprite() {
  const zapytanie = $("#szukaj").value;
  const kat = new Map(), pod = new Map();
  let suma = 0;
  for (const r of widoczne()) {
    for (const p of szukaj(stan.dane.get(r.id).przedmioty, zapytanie, "")) {
      suma++;
      kat.set(p.kat, (kat.get(p.kat) || 0) + 1);
      if (p.kat === ust.kategoria) pod.set(p.pod, (pod.get(p.pod) || 0) + 1);
    }
  }
  return { suma, kat, pod };
}

function ikonaKategorii(k) {
  for (const id of k.ikona || []) {
    for (const r of widoczne()) {
      const p = stan.dane.get(r.id).m.poId.get(id);
      if (p) return { repo: r.id, p };
    }
  }
  return null;
}

function rysujKategorie() {
  const dzwieki = ust.zakladka === "dzwieki";
  const lista = dzwieki ? kategorieDzwiekow : kategorieSprite;
  const kl = dzwieki ? "dzKategoria" : "kategoria";
  const kp = dzwieki ? "dzPodgrupa" : "podgrupa";
  if (ust[kl] && !lista.some((k) => k.id === ust[kl])) { ust[kl] = ""; ust[kp] = ""; }
  const l = dzwieki ? Dzwieki.liczniki(ust.dzKategoria) : liczSprite();
  const wybierz = (id) => {
    ust[kl] = ust[kl] === id ? "" : id;
    ust[kp] = "";
    zapisz();
    przelicz();
  };
  const przyciski = [el("button", { klasa: "kat" + (!ust[kl] ? " aktywny" : ""), onclick: () => wybierz("") },
    el("span", { klasa: "ikona-kat" }, "★"), el("span", { klasa: "nazwa" }, "Wszystko"), el("small", {}, l.suma.toLocaleString("pl")))];
  for (const k of lista) {
    const ile = l.kat.get(k.id) || 0;
    if (!ile && ust[kl] !== k.id) continue;
    const ikona = dzwieki ? el("span", { klasa: "ikona-kat" }, "♪") : el("canvas", { width: 24, height: 24 });
    if (!dzwieki) {
      const ik = ikonaKategorii(k);
      if (ik) rysujMiniature(ikona, ik.repo, ik.p.s, 24);
    }
    przyciski.push(el("button", { klasa: "kat" + (ust[kl] === k.id ? " aktywny" : ""), title: k.nazwa, onclick: () => wybierz(k.id) },
      ikona, el("span", { klasa: "nazwa" }, k.nazwa), el("small", {}, ile.toLocaleString("pl"))));
  }
  $("#listaKategorii").replaceChildren(...przyciski);

  // podgrupy wybranej kategorii
  const box = $("#podgrupy");
  if (!ust[kl] || l.pod.size < 2) { box.replaceChildren(); box.hidden = true; return; }
  box.hidden = false;
  const pod = [...l.pod.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  const chip = (nazwa, wartosc, ile) => el("button", {
    klasa: "pod" + (ust[kp] === wartosc ? " aktywny" : ""),
    onclick: () => { ust[kp] = ust[kp] === wartosc ? "" : wartosc; zapisz(); przelicz(); },
  }, nazwa, ile !== undefined ? el("small", {}, String(ile)) : null);
  box.replaceChildren(chip("wszystko", ""), ...pod.map(([n, ile]) => chip(n, n, ile)));
}

function przelicz() {
  if (ust.zakladka === "dzwieki") {
    if (widoczne().length) Dzwieki.pokaz(widoczne(), ust.dzKategoria, ust.dzPodgrupa).then(rysujKategorie);
    return;
  }
  rysujKategorie();
  stan.wiersze = [];
  stan.generator = generujWiersze();
  stan.koniec = false;
  rysujNaglowki();
  $("#wiersze").replaceChildren();
  dociagnij(50);
}

function dociagnij(ile) {
  if (stan.koniec || !stan.generator) return;
  const box = $("#wiersze");
  const t0 = performance.now();
  for (let i = 0; i < ile; i++) {
    const n = stan.generator.next();
    if (n.done) { stan.koniec = true; break; }
    stan.wiersze.push(n.value);
    box.append(rysujWiersz(n.value, stan.wiersze.length - 1));
    if (performance.now() - t0 > 400) break;
  }
  const repa = widoczne();
  $("#stopka").textContent = !repa.length
    ? (stan.repa.length ? "Wczytuję repo…" : "Dodaj repozytorium przyciskiem „+ Dodaj repo”.")
    : stan.koniec
      ? (stan.wiersze.length ? `${stan.wiersze.length.toLocaleString("pl")} przedmiotów` : "Nic nie znaleziono.")
      : `${stan.wiersze.length.toLocaleString("pl")} przedmiotów, przewiń po więcej`;
}

new IntersectionObserver((w) => { if (w[0].isIntersecting) dociagnij(40); }, { rootMargin: "600px" }).observe($("#stopka"));

function rysujNaglowki() {
  const repa = widoczne();
  document.documentElement.style.setProperty("--kolumny", repa.length);
  document.documentElement.style.setProperty("--miniatura", `${32 * ust.skala}px`);
  $("#naglowkiTabeli").replaceChildren(el("div", { klasa: "kom pierwsza" }, "Przedmiot"),
    ...repa.map((r) => el("div", { klasa: "kom" },
      el("span", { klasa: "rodzaj " + r.rodzaj }, etykieta(r)),
      el("b", {}, r.nazwa),
      el("button", { klasa: "menuRepo", title: "Opcje kolumny", onclick: (e) => { e.stopPropagation(); pokazMenuRepo(r, e.currentTarget); } }, "⋯"))));
}

const OPIS_JAK = { pewne: "pewne", mozliwe: "możliwe", reczne: "ręcznie", wzor: "wzorzec", brak: "", "brak-recznie": "brak (ręcznie)" };
const normalna = (n) => (n || "").toLowerCase().trim();

function rysujWiersz(w, i) {
  const repa = widoczne();
  const nazwaZr = stan.repa.find((r) => r.id === w.zrodlo)?.nazwa;
  const wiersz = el("div", { klasa: "wiersz", onclick: () => otworzSzczegoly(i) },
    el("div", { klasa: "kom pierwsza" },
      el("b", {}, w.p.n || "(bez nazwy)"),
      el("small", { title: w.p.id }, `${nazwaZr}: ${w.p.id}`),
      el("span", { klasa: "ile" + (w.ile === repa.length - 1 ? " wszystkie" : "") }, `w ${w.ile + 1} z ${repa.length} repo`)));
  for (const r of repa) {
    const k = w.komorki[r.id];
    const kom = el("div", { klasa: "kom sprite tlo-" + ust.tloTabeli + (k.p ? "" : " pusta") });
    if (k.p) {
      const c = el("canvas", { width: 32 * ust.skala, height: 32 * ust.skala });
      rysujMiniature(c, r.id, k.p.s, 32 * ust.skala);
      kom.append(c);
      kom.title = `${k.p.n}\n${k.p.id}${k.powody?.length ? "\n" + OPIS_JAK[k.jak] + ": " + k.powody.join(", ") : ""}`;
      if (k.jak !== "wzor") kom.append(el("span", { klasa: "znacznik " + k.jak }));
      if (k.p.n && k.jak !== "wzor" && normalna(k.p.n) !== normalna(w.p.n)) kom.append(el("small", { klasa: "inna-nazwa" }, k.p.n));
    } else {
      kom.append(el("span", { klasa: "brak" }, k.jak === "brak-recznie" ? "brak" : "—"));
    }
    wiersz.append(kom);
  }
  return wiersz;
}

async function rysujMiniature(canvas, repo, warstwy, rozmiar = 32) {
  const st = await Promise.all(warstwy.map((w) => Sprite.stan(repo, w[0], w[1])));
  const ok = st.filter(Boolean);
  if (!ok.length) return;
  const w = Math.max(...ok.map((s) => s.szer)), h = Math.max(...ok.map((s) => s.wys));
  // Całkowita skala, żeby piksele były ostre; większe sprite'y zmniejszamy, żeby się zmieściły.
  let skala = rozmiar / Math.max(w, h);
  if (skala >= 1) skala = Math.floor(skala);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const x0 = (rozmiar - w * skala) / 2, y0 = (rozmiar - h * skala) / 2;
  st.forEach((s, i) => {
    if (s) Sprite.rysuj(ctx, s, 0, 0, Math.round(x0 + ((w - s.szer) / 2) * skala), Math.round(y0 + (h - s.wys) * skala), skala, warstwy[i][2]);
  });
}

// ---------------------------------------------------------------- szczegóły wiersza

const animowane = new Set();
let start = performance.now();
function petla() {
  if (ust.anim && $("#szczegoly").open) for (const f of animowane) f(performance.now() - start);
  requestAnimationFrame(petla);
}
requestAnimationFrame(petla);

function otworzSzczegoly(i) {
  stan.biezacy = i;
  if (!$("#szczegoly").open) $("#szczegoly").showModal();
  rysujSzczegoly();
}

function przejdz(o) {
  const j = stan.biezacy + o;
  if (j < 0) return;
  if (j >= stan.wiersze.length) dociagnij(40);
  if (j < stan.wiersze.length) otworzSzczegoly(j);
}
$("#poprzedni").addEventListener("click", () => przejdz(-1));
$("#nastepny").addEventListener("click", () => przejdz(1));
$("#zamknij").addEventListener("click", () => $("#szczegoly").close());
$("#szczegoly").addEventListener("close", () => {
  animowane.clear();
  // odśwież wiersz w tabeli, bo w szczegółach mogły się zmienić odpowiedniki
  const w = stan.wiersze[stan.biezacy];
  const stary = $("#wiersze").children[stan.biezacy];
  if (w && stary) {
    let ile = 0;
    for (const r of widoczne()) if (r.id !== w.zrodlo && w.komorki[r.id]?.p) ile++;
    w.ile = ile;
    stary.replaceWith(rysujWiersz(w, stan.biezacy));
  }
});

const NAZWY_KIER = ["S", "N", "E", "W"];

async function scena(repo, warstwy, opcje = {}) {
  const box = el("div", { klasa: "scena tlo-" + ust.tlo });
  if (!warstwy || !warstwy.length) {
    box.classList.add("brak");
    box.append(el("span", {}, opcje.brak || "brak sprite'a"));
    return { box, w: 0, h: 0 };
  }
  const st = await Promise.all(warstwy.map((w) => Sprite.stan(repo, w[0], w[1])));
  const ok = st.filter(Boolean);
  if (!ok.length) {
    box.classList.add("brak");
    box.append(el("span", {}, "nie wczytano pliku"));
    return { box, w: 0, h: 0 };
  }
  const szer = Math.max(...ok.map((s) => s.szer)), wys = Math.max(...ok.map((s) => s.wys));
  const maxKier = Math.max(...ok.map((s) => s.s.kierunki));
  const kierunki = ust.kier === -1 ? (maxKier > 1 ? [0, 1, 2, 3] : [0]) : [ust.kier];
  const z = ust.zoom;
  for (const k of kierunki) {
    const c = el("canvas", { width: szer * z, height: wys * z, title: opcje.tytul || "" });
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const rysuj = (czas) => {
      ctx.clearRect(0, 0, c.width, c.height);
      st.forEach((s, i) => {
        if (s) Sprite.rysuj(ctx, s, k, Sprite.numerKlatki(s.s, czas), ((szer - s.szer) / 2) * z, (wys - s.wys) * z, z, warstwy[i][2]);
      });
    };
    rysuj(0);
    if (ok.some((s) => s.s.klatki > 1)) animowane.add(rysuj);
    const kafel = el("figure", {}, c);
    if (kierunki.length > 1) kafel.append(el("figcaption", {}, NAZWY_KIER[k]));
    box.append(kafel);
  }
  return { box, w: szer, h: wys };
}

function kopiuj(tekst, e) {
  e.stopPropagation();
  navigator.clipboard?.writeText(tekst);
  const t = e.currentTarget;
  t.classList.add("skopiowano");
  setTimeout(() => t.classList.remove("skopiowano"), 700);
}

let numerSzczegolow = 0;
async function rysujSzczegoly() {
  const nr = ++numerSzczegolow;
  animowane.clear();
  const w = stan.wiersze[stan.biezacy];
  if (!w) return;
  for (const r of widoczne()) w.komorki[r.id] = komorka(w.zrodlo, w.p, r.id);
  $("#tytul").replaceChildren(el("h2", {}, w.p.n || w.p.id), el("small", {}, `wiersz ${stan.biezacy + 1}`));
  const karty = await Promise.all(widoczne().map((r) => karta(w, r)));
  if (nr !== numerSzczegolow) return;
  const box = $("#karty");
  box.replaceChildren(...karty.map((k) => k.el));
  const sw = Math.max(32, ...karty.map((k) => k.w)), sh = Math.max(32, ...karty.map((k) => k.h));
  box.style.setProperty("--scena-w", `${sw * ust.zoom}px`);
  box.style.setProperty("--scena-h", `${sh * ust.zoom}px`);
  box.style.setProperty("--z", ust.zoom);
  const kol = ust.kier === -1 ? 4 : 1;
  box.style.setProperty("--karta-w", `${Math.max(250, kol * sw * ust.zoom + (kol - 1) * 4 + 26)}px`);
}

async function karta(w, repo) {
  const k = w.komorki[repo.id];
  const wzor = repo.id === w.zrodlo;
  const p = k.p;
  const dane = stan.dane.get(repo.id);
  const art = el("article", { klasa: "karta" + (wzor ? " wzor" : "") + (p ? "" : " pusta") },
    el("header", {},
      el("span", { klasa: "rodzaj " + repo.rodzaj }, etykieta(repo)),
      el("b", {}, repo.nazwa),
      dane.wersja ? el("small", { title: dane.wersja.sha }, dane.wersja.data) : null));
  let sw = 0, sh = 0;
  if (!p) {
    art.append(el("div", { klasa: "scena brak tlo-" + ust.tlo }, el("span", {}, k.jak === "brak-recznie" ? "oznaczone ręcznie: brak odpowiednika" : "nie znaleziono odpowiednika")));
  } else {
    const sceny = [];
    if (ust.widok === "s") sceny.push(await scena(repo.id, p.s));
    else if (ust.widok === "r") {
      sceny.push(await scena(repo.id, p.l, { brak: "brak sprite'a w lewej ręce", tytul: "lewa ręka" }));
      sceny.push(await scena(repo.id, p.p, { brak: "brak sprite'a w prawej ręce", tytul: "prawa ręka" }));
    } else sceny.push(await scena(repo.id, p.w, { brak: "brak sprite'a na postaci" }));
    for (const s of sceny) { art.append(s.box); sw = Math.max(sw, s.w); sh = Math.max(sh, s.h); }
    const plik = p.s[0];
    const info = el("div", { klasa: "info" },
      el("div", { klasa: "nazwa" }, p.n || "(bez nazwy)"),
      p.d ? el("p", { klasa: "opisp", title: p.d }, p.d) : null,
      el("code", { klasa: "kopiuj", title: "Kliknij, żeby skopiować", onclick: (e) => kopiuj(p.id, e) }, p.id),
      el("code", { klasa: "kopiuj plik", title: "Kliknij, żeby skopiować ścieżkę pliku", onclick: (e) => kopiuj(plik[0], e) },
        plik[0], el("br"), `stan: "${plik[1]}"`, p.s.length > 1 ? ` (+${p.s.length - 1} warstw)` : ""));
    art.append(info);
    const meta = plik[0].endsWith(".rsi") ? await Sprite.plik(repo.id, plik[0]) : null;
    if (meta && (meta.licencja || meta.autorzy)) info.append(el("p", { klasa: "licencja", title: meta.autorzy }, `${meta.licencja}${meta.autorzy ? " · " + meta.autorzy : ""}`));
  }
  const stopka = el("footer", {});
  if (wzor) stopka.append(el("span", { klasa: "jak wzor" }, "od tego przedmiotu zaczyna się wiersz"));
  else {
    if (p) stopka.append(el("span", { klasa: "jak " + k.jak }, `${OPIS_JAK[k.jak]}: ${k.powody.join(", ")}`));
    const prop = propozycje(w.p, dane, ust.kryteria, 5).filter((x) => x.p !== p);
    if (prop.length) {
      stopka.append(el("div", { klasa: "inne" }, el("small", {}, "Inne propozycje:"),
        ...prop.slice(0, 4).map((x) => {
          const c = el("canvas", { width: 32, height: 32 });
          rysujMiniature(c, repo.id, x.p.s, 32);
          return el("button", {
            klasa: "propozycja-sprite",
            title: `${x.p.n}\n${x.p.id}\n${x.powody.join(", ")} (${Math.round(x.pkt)} pkt)\nKliknij, żeby wybrać`,
            onclick: async () => { await ustawReczny(w.zrodlo, w.p, repo.id, x.p); rysujSzczegoly(); },
          }, c);
        })));
    }
    stopka.append(el("div", { klasa: "rzad" },
      el("button", { klasa: "przycisk maly", onclick: () => otworzWybor(w, repo) }, "Wskaż inny…"),
      p && k.jak !== "reczne" ? el("button", { klasa: "przycisk maly", title: "Zapamiętaj to dopasowanie na stałe", onclick: async () => { await ustawReczny(w.zrodlo, w.p, repo.id, p); rysujSzczegoly(); } }, "✓ Dobrze") : null,
      p ? el("button", { klasa: "przycisk maly", onclick: async () => { await ustawReczny(w.zrodlo, w.p, repo.id, null); rysujSzczegoly(); } }, "Brak odpowiednika") : null,
      k.jak === "reczne" || k.jak === "brak-recznie" ? el("button", { klasa: "przycisk maly", onclick: async () => { await ustawReczny(w.zrodlo, w.p, repo.id, undefined); rysujSzczegoly(); } }, "Automatycznie") : null));
  }
  if (p) stopka.append(el("button", { klasa: "przycisk maly", onclick: (e) => przelaczStany(art, repo.id, p, e.currentTarget) }, "Wszystkie stany pliku"));
  art.append(stopka);
  return { el: art, w: sw, h: sh };
}

async function przelaczStany(karta, repo, p, przycisk) {
  const stary = karta.querySelector(".stany");
  if (stary) { stary.remove(); przycisk.classList.remove("aktywny"); return; }
  przycisk.classList.add("aktywny");
  const plik = await Sprite.plik(repo, p.s[0][0]);
  if (!plik) return;
  const box = el("div", { klasa: "stany" });
  const filtr = el("input", { type: "search", placeholder: `Filtruj ${plik.kolejnosc.length} stanów` });
  const siatka = el("div", { klasa: "siatka" });
  box.append(filtr, siatka);
  const pokaz = () => {
    const f = filtr.value.toLowerCase();
    siatka.replaceChildren();
    for (const nazwa of plik.kolejnosc) {
      if (f && !nazwa.toLowerCase().includes(f)) continue;
      const c = el("canvas", { width: 64, height: 64 });
      siatka.append(el("figure", { klasa: nazwa === p.s[0][1] ? "biezacy" : "", title: nazwa }, c, el("figcaption", {}, nazwa || "(bez nazwy)")));
      rysujMiniature(c, repo, [[p.s[0][0], nazwa]], 64);
      if (siatka.children.length >= 300) break;
    }
  };
  filtr.addEventListener("input", pokaz);
  pokaz();
  karta.querySelector("footer").before(box);
}

// ---------------------------------------------------------------- ręczny wybór

let wybor = null;
function otworzWybor(w, repo) {
  wybor = { w, repo };
  $("#wyborTytul").textContent = `Odpowiednik w ${repo.nazwa} dla „${w.p.n || w.p.id}”`;
  $("#wyborSzukaj").value = w.p.n || "";
  rysujWybor();
  $("#oknoWybor").showModal();
  $("#wyborSzukaj").select();
}

function rysujWybor() {
  const { w, repo } = wybor;
  const dane = stan.dane.get(repo.id);
  const wyniki = szukaj(dane.przedmioty, $("#wyborSzukaj").value, "", 200);
  $("#wyborLista").replaceChildren(...wyniki.map((p) => {
    const c = el("canvas", { width: 32, height: 32 });
    rysujMiniature(c, repo.id, p.s);
    const o = ocen(w.p, p, ust.kryteria);
    return el("li", { onclick: async () => { await ustawReczny(w.zrodlo, w.p, repo.id, p); $("#oknoWybor").close(); rysujSzczegoly(); } },
      c, el("div", { klasa: "opis" }, el("b", {}, p.n || "(bez nazwy)"), el("small", {}, p.id)),
      o.powody.length ? el("small", { klasa: "powody" }, o.powody.join(", ")) : null);
  }));
}
$("#wyborSzukaj").addEventListener("input", () => { clearTimeout(rysujWybor._t); rysujWybor._t = setTimeout(rysujWybor, 120); });
$("#wyborZamknij").addEventListener("click", () => $("#oknoWybor").close());

// ---------------------------------------------------------------- sterowanie

function grupa(sel, atr, kl, zamien = (x) => x) {
  const przyciski = document.querySelectorAll(`${sel} button`);
  const odswiez = () => przyciski.forEach((b) => b.classList.toggle("aktywny", zamien(b.dataset[atr]) === ust[kl]));
  przyciski.forEach((b) => b.addEventListener("click", () => { ust[kl] = zamien(b.dataset[atr]); zapisz(); odswiez(); rysujSzczegoly(); }));
  odswiez();
}
grupa("#widoki", "widok", "widok");
grupa("#kierunki", "kier", "kier", Number);
grupa("#tla", "tlo", "tlo");

$("#zoom").value = ust.zoom;
$("#zoomWartosc").textContent = ust.zoom + "×";
$("#zoom").addEventListener("input", (e) => {
  ust.zoom = +e.target.value; $("#zoomWartosc").textContent = ust.zoom + "×"; zapisz();
  clearTimeout(rysujSzczegoly._t); rysujSzczegoly._t = setTimeout(rysujSzczegoly, 60);
});

function przelaczAnimacje() {
  ust.anim = !ust.anim; zapisz();
  $("#animacja").textContent = ust.anim ? "⏸ Animacja" : "▶ Animacja";
  if (!ust.anim) for (const f of animowane) f(0);
  start = performance.now();
}
$("#animacja").textContent = ust.anim ? "⏸ Animacja" : "▶ Animacja";
$("#animacja").addEventListener("click", przelaczAnimacje);

document.addEventListener("keydown", (e) => {
  if (!$("#szczegoly").open || $("#oknoWybor").open) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  if (e.key === " ") { e.preventDefault(); przelaczAnimacje(); }
  if (e.key === "ArrowDown") { e.preventDefault(); przejdz(1); }
  if (e.key === "ArrowUp") { e.preventDefault(); przejdz(-1); }
});

for (const [k, nazwa] of Object.entries(KRYTERIA)) {
  const pole = el("input", { type: "checkbox" });
  pole.checked = ust.kryteria[k];
  pole.addEventListener("change", () => {
    ust.kryteria[k] = pole.checked;
    if (!Object.values(ust.kryteria).some(Boolean)) { ust.kryteria[k] = true; pole.checked = true; }
    zapisz(); przelicz();
  });
  $("#kryteria").append(el("label", { klasa: "przelacznik" }, pole, nazwa));
}

$("#szukaj").addEventListener("input", () => {
  clearTimeout(przelicz._t);
  przelicz._t = setTimeout(() => (ust.zakladka === "dzwieki" ? (Dzwieki.szukajZmienione(), rysujKategorie()) : przelicz()), 200);
});

document.addEventListener("change", (e) => { if (e.target.matches("#dzTryb, #dzRepo")) rysujKategorie(); });

// Zakładki: sprite'y i dźwięki
window.__repoInfo = (id) => stan.dane.get(id);
const SZUKAJ = { sprite: "Szukaj przedmiotu, np. crowbar, captain, /obj/item/gun", dzwieki: "Szukaj dźwięku, np. airlock, gunshot, weapons/laser" };
function ustawZakladke(z) {
  ust.zakladka = z; zapisz();
  document.body.classList.remove("zakladka-sprite", "zakladka-dzwieki");
  document.body.classList.add("zakladka-" + z);
  document.querySelectorAll("#zakladki button").forEach((b) => b.classList.toggle("aktywny", b.dataset.zakladka === z));
  $("#szukaj").placeholder = SZUKAJ[z];
  przelicz();
}
document.querySelectorAll("#zakladki button").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.zakladka === ust.zakladka) return;
  $("#szukaj").value = "";
  ustawZakladke(b.dataset.zakladka);
}));
document.body.classList.add("zakladka-" + ust.zakladka);
document.querySelectorAll("#zakladki button").forEach((b) => b.classList.toggle("aktywny", b.dataset.zakladka === ust.zakladka));
$("#szukaj").placeholder = SZUKAJ[ust.zakladka];
$("#zrodloWierszy").addEventListener("change", (e) => { ust.zrodloWierszy = e.target.value; zapisz(); przelicz(); });
$("#skala").value = String(ust.skala);
$("#skala").addEventListener("change", (e) => { ust.skala = +e.target.value; zapisz(); przelicz(); });
$("#tloTabeli").value = ust.tloTabeli;
$("#tloTabeli").addEventListener("change", (e) => { ust.tloTabeli = e.target.value; zapisz(); przelicz(); });
$("#tylkoZOdp").checked = ust.tylkoZOdp;
$("#tylkoZOdp").addEventListener("change", (e) => { ust.tylkoZOdp = e.target.checked; zapisz(); przelicz(); });

// ---------------------------------------------------------------- start

(async () => {
  await Promise.all([wykryj(), wczytajKategorie()]);
  document.body.classList.toggle("statyczny", zrodlo.statyczny);
  const [reguly, reczne] = await Promise.all([api.get("/api/sciezki"), api.get("/api/reczne")]);
  ustawReguly(reguly);
  stan.reczne = reczne && reczne.pary ? reczne : { pary: {} };
  await odswiezRepa();
  przelicz();
})();
