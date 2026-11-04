import * as Sprite from "./sprite.js";
import { przygotuj, dopasuj, dopasujDokladnie, szukaj } from "./dopasowanie.js";

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

const ZAPIS = "porownywarka:v1";
function wczytajUstawienia() {
  try { return JSON.parse(localStorage.getItem(ZAPIS)) || {}; } catch { return {}; }
}
const ust = Object.assign({ widok: "s", kier: 0, zoom: 5, tlo: "szachownica", anim: true, ukryte: [], recznie: {}, wzorzec: null, minimum: 1, kategoria: "" }, wczytajUstawienia());
function zapisz() {
  try { localStorage.setItem(ZAPIS, JSON.stringify(ust)); } catch { /* prywatne okno */ }
}

const stan = {
  repa: [],              // z serwera
  dane: new Map(),       // id repo -> indeks (przedmioty + mapy pomocnicze)
  ladowane: new Set(),
  wybrany: null,         // przedmiot z repo wzorcowego
  lista: [],             // przefiltrowane przedmioty
  pokazane: 400,
  liczniki: new Map(),   // przedmiot -> liczba odpowiedników
};

const api = {
  async get(url) { const r = await fetch(url); return r.json(); },
  async post(url, dane) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dane) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.blad || r.statusText);
    return j;
  },
};

// ---------------------------------------------------------------- repozytoria

const widoczne = () => stan.repa.filter((r) => !ust.ukryte.includes(r.id) && stan.dane.has(r.id));
const nazwaRepo = (id) => stan.repa.find((r) => r.id === id)?.nazwa ?? "?";

async function odswiezRepa() {
  stan.repa = await api.get("/api/repo");
  for (const r of stan.repa) {
    if (r.stan.etap === "gotowe" && !stan.dane.has(r.id) && !stan.ladowane.has(r.id)) wczytajIndeks(r.id);
  }
  rysujRepa();
  if (stan.repa.some((r) => !["gotowe", "błąd", "brak"].includes(r.stan.etap))) setTimeout(odswiezRepa, 1500);
}

async function wczytajIndeks(id) {
  stan.ladowane.add(id);
  rysujRepa();
  try {
    const dane = await api.get(`/api/indeks/${id}`);
    przygotuj(dane);
    stan.dane.set(id, dane);
  } catch (e) {
    console.warn("indeks", id, e);
  }
  stan.ladowane.delete(id);
  stan.liczniki.clear();
  if (!ust.wzorzec || !stan.repa.some((r) => r.id === ust.wzorzec)) ust.wzorzec = id;
  rysujRepa();
  rysujWzorce();
  filtruj();
  if (!stan.wybrany) zHasha();
  else rysujKarty();
}

function rysujRepa() {
  const box = $("#repa");
  box.replaceChildren();
  stan.repa.forEach((r, i) => {
    const s = r.stan;
    let opis;
    if (stan.ladowane.has(r.id)) opis = "wczytuję…";
    else if (s.etap === "gotowe") opis = stan.dane.has(r.id) ? `${stan.dane.get(r.id).przedmioty.length.toLocaleString("pl")} sprite'ów` : "gotowe";
    else if (s.etap === "błąd") opis = "błąd";
    else opis = `indeksuję: ${s.etap}…`;
    const ukryte = ust.ukryte.includes(r.id);
    const w = stan.dane.get(r.id)?.wersja;
    const chip = el("div", {
      klasa: "repo" + (ukryte ? " ukryte" : "") + (s.etap === "błąd" ? " zle" : "") + (r.id === ust.wzorzec ? " wzor" : ""),
      title: `${r.sciezka}\n${r.rodzaj.toUpperCase()}${w ? `, commit ${w.sha.slice(0, 9)} z ${w.data}` : ""}${s.blad ? "\nBłąd: " + s.blad : ""}\nKliknij, żeby ukryć lub pokazać kolumnę.`,
    },
    el("span", { klasa: "rodzaj " + r.rodzaj }, r.rodzaj === "ss14" ? "14" : "13"),
    el("b", {}, r.nazwa),
    el("small", {}, opis),
    el("span", { klasa: "akcje" },
      el("button", { title: "W lewo", onclick: (e) => { e.stopPropagation(); przesun(i, -1); } }, "◀"),
      el("button", { title: "W prawo", onclick: (e) => { e.stopPropagation(); przesun(i, 1); } }, "▶"),
      el("button", { title: "Przeczytaj repo od nowa", onclick: async (e) => { e.stopPropagation(); await api.post("/api/odswiez", { id: r.id }); stan.dane.delete(r.id); odswiezRepa(); } }, "↻"),
      el("button", { title: "Zmień nazwę", onclick: async (e) => {
        e.stopPropagation();
        const n = prompt("Nowa nazwa repo:", r.nazwa);
        if (n) { await api.post("/api/zmien", { id: r.id, nazwa: n }); odswiezRepa().then(() => { rysujWzorce(); rysujKarty(); }); }
      } }, "✎"),
      el("button", { title: "Usuń z listy (plików repo nie rusza)", onclick: async (e) => {
        e.stopPropagation();
        if (!confirm(`Usunąć „${r.nazwa}” z porównywarki? Pliki repo zostają na dysku.`)) return;
        await api.post("/api/usun", { id: r.id });
        stan.dane.delete(r.id);
        await odswiezRepa();
        rysujWzorce(); filtruj(); rysujKarty();
      } }, "✕"),
    ));
    chip.addEventListener("click", () => {
      ust.ukryte = ukryte ? ust.ukryte.filter((x) => x !== r.id) : [...ust.ukryte, r.id];
      zapisz(); stan.liczniki.clear(); rysujRepa(); filtruj(); rysujKarty();
    });
    box.append(chip);
  });
}

async function przesun(i, o) {
  const j = i + o;
  if (j < 0 || j >= stan.repa.length) return;
  const k = stan.repa.map((r) => r.id);
  [k[i], k[j]] = [k[j], k[i]];
  await api.post("/api/zmien", { kolejnosc: k });
  await odswiezRepa();
  rysujWzorce(); rysujKarty();
}

function rysujWzorce() {
  const s = $("#wzorzec");
  s.replaceChildren(...stan.repa.filter((r) => stan.dane.has(r.id)).map((r) => el("option", { value: r.id, selected: r.id === ust.wzorzec }, r.nazwa)));
}

// ---------------------------------------------------------------- okno dodawania repo

$("#dodajRepo").addEventListener("click", async () => {
  $("#bladRepo").textContent = "";
  const box = $("#propozycje");
  box.replaceChildren(el("small", {}, "Szukam repo obok…"));
  $("#oknoRepo").showModal();
  const prop = await api.get("/api/propozycje");
  box.replaceChildren(prop.length ? el("small", {}, "Znalezione obok (kliknij, żeby wpisać):") : "");
  for (const p of prop) {
    box.append(el("button", { type: "button", klasa: "propozycja", onclick: () => { $("#sciezkaRepo").value = p.sciezka; $("#nazwaRepo").value = p.nazwa; } },
      el("span", { klasa: "rodzaj " + p.rodzaj }, p.rodzaj === "ss14" ? "14" : "13"), p.nazwa));
  }
});

$("#zatwierdzRepo").addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    await api.post("/api/repo", { sciezka: $("#sciezkaRepo").value, nazwa: $("#nazwaRepo").value });
    $("#sciezkaRepo").value = ""; $("#nazwaRepo").value = "";
    $("#oknoRepo").close();
    odswiezRepa();
  } catch (err) {
    $("#bladRepo").textContent = err.message;
  }
});

// ---------------------------------------------------------------- lista

function liczOdpowiedniki(p) {
  let n = stan.liczniki.get(p);
  if (n === undefined) {
    n = 0;
    for (const r of widoczne()) {
      if (r.id === ust.wzorzec) continue;
      if (dopasujDokladnie(p, stan.dane.get(r.id))) n++;
    }
    stan.liczniki.set(p, n);
  }
  return n;
}

function filtruj() {
  const dane = stan.dane.get(ust.wzorzec);
  if (!dane) { stan.lista = []; rysujListe(); return; }
  const minimum = Math.min(ust.minimum, widoczne().filter((r) => r.id !== ust.wzorzec).length);
  let lista = szukaj(dane.przedmioty, $("#szukaj").value, ust.kategoria);
  if (minimum > 0) lista = lista.filter((p) => liczOdpowiedniki(p) >= minimum);
  stan.lista = lista;
  stan.pokazane = 400;
  rysujListe();
}

const obserwator = new IntersectionObserver((wpisy) => {
  for (const w of wpisy) {
    if (!w.isIntersecting) continue;
    obserwator.unobserve(w.target);
    const { repo, p } = w.target._dane;
    rysujMiniature(w.target, repo, p.s);
  }
}, { root: $("#lista"), rootMargin: "200px" });

async function rysujMiniature(canvas, repo, warstwy, rozmiar = 32) {
  const st = await Promise.all(warstwy.map((w) => Sprite.stan(repo, w[0], w[1])));
  const ok = st.filter(Boolean);
  if (!ok.length) return;
  const w = Math.max(...ok.map((s) => s.szer)), h = Math.max(...ok.map((s) => s.wys));
  const skala = Math.min(rozmiar / w, rozmiar / h);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  st.forEach((s, i) => {
    if (s) Sprite.rysuj(ctx, s, 0, 0, (rozmiar - s.szer * skala) / 2, (rozmiar - s.wys * skala) / 2, skala, warstwy[i][2]);
  });
}

function rysujListe() {
  const ul = $("#lista");
  ul.replaceChildren();
  const n = widoczne().filter((r) => r.id !== ust.wzorzec).length;
  $("#licznik").textContent = stan.dane.has(ust.wzorzec) ? `${stan.lista.length.toLocaleString("pl")} pozycji` : "Brak wczytanego repo.";
  for (const p of stan.lista.slice(0, stan.pokazane)) {
    const c = el("canvas", { width: 32, height: 32 });
    c._dane = { repo: ust.wzorzec, p };
    const ile = liczOdpowiedniki(p);
    const li = el("li", { klasa: p === stan.wybrany ? "wybrany" : "", title: p.id, onclick: () => wybierz(p) },
      c,
      el("div", { klasa: "opis" }, el("b", {}, p.n || "(bez nazwy)"), el("small", {}, p.id)),
      n ? el("span", { klasa: "ile" + (ile === n ? " wszystkie" : ""), title: `Pewne odpowiedniki w ${ile} z ${n} pozostałych repo` }, `${ile}/${n}`) : null);
    li._p = p;
    ul.append(li);
    obserwator.observe(c);
  }
  if (stan.lista.length > stan.pokazane) {
    ul.append(el("li", { klasa: "wiecej", onclick: () => { stan.pokazane += 400; rysujListe(); } }, `Pokaż więcej (${(stan.lista.length - stan.pokazane).toLocaleString("pl")})`));
  }
}

$("#szukaj").addEventListener("input", () => { clearTimeout(filtruj._t); filtruj._t = setTimeout(filtruj, 150); });
$("#wzorzec").addEventListener("change", (e) => { ust.wzorzec = e.target.value; zapisz(); stan.liczniki.clear(); rysujRepa(); filtruj(); });
$("#kategoria").value = ust.kategoria;
$("#kategoria").addEventListener("change", (e) => { ust.kategoria = e.target.value; zapisz(); filtruj(); });
$("#minimum").value = String(ust.minimum);
$("#minimum").addEventListener("change", (e) => { ust.minimum = +e.target.value; zapisz(); filtruj(); });

$("#lista").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const i = stan.lista.indexOf(stan.wybrany);
  const j = Math.max(0, Math.min(stan.lista.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
  if (stan.lista[j]) wybierz(stan.lista[j]);
  $("#lista .wybrany")?.scrollIntoView({ block: "nearest" });
});

function wybierz(p) {
  stan.wybrany = p;
  for (const li of $("#lista").children) li.classList.toggle("wybrany", li._p === p);
  history.replaceState(null, "", `#w=${encodeURIComponent(ust.wzorzec)}&p=${encodeURIComponent(p.id)}`);
  rysujKarty();
}

function zHasha() {
  const h = new URLSearchParams(location.hash.slice(1));
  const w = h.get("w"), id = h.get("p");
  if (!w || !id) return;
  const d = stan.dane.get(w);
  const p = d?.poId.get(id);
  if (!p) return;
  if (ust.wzorzec !== w) { ust.wzorzec = w; rysujWzorce(); filtruj(); }
  wybierz(p);
}

// ---------------------------------------------------------------- karty porównania

const animowane = new Set();   // funkcje rysujące (czas) => void
let start = performance.now();

function petla() {
  if (ust.anim) for (const f of animowane) f(performance.now() - start);
  requestAnimationFrame(petla);
}
requestAnimationFrame(petla);

function kluczRecznych() { return `${ust.wzorzec}|${stan.wybrany?.id}`; }

function odpowiednik(repoId) {
  const p = stan.wybrany;
  if (repoId === ust.wzorzec) return { p, jak: "wzorzec" };
  const r = ust.recznie[kluczRecznych()];
  if (r && repoId in r) {
    if (r[repoId] === null) return { p: null, jak: "ręcznie: brak" };
    const x = stan.dane.get(repoId).poId.get(r[repoId]);
    if (x) return { p: x, jak: "wybrany ręcznie" };
  }
  return dopasuj(p, stan.dane.get(repoId));
}

const NAZWY_KIER = ["S", "N", "E", "W"];

// Scena: jeden lub kilka kierunków danego zestawu warstw.
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
    const animuje = ok.some((s) => s.s.klatki > 1);
    const rysuj = (czas) => {
      ctx.clearRect(0, 0, c.width, c.height);
      st.forEach((s, i) => {
        if (!s) return;
        const klatka = Sprite.numerKlatki(s.s, czas);
        Sprite.rysuj(ctx, s, k, klatka, ((szer - s.szer) / 2) * z, (wys - s.wys) * z, z, warstwy[i][2]);
      });
    };
    rysuj(0);
    if (animuje) animowane.add(rysuj);
    const kafel = el("figure", {}, c);
    if (kierunki.length > 1) kafel.append(el("figcaption", {}, NAZWY_KIER[k]));
    box.append(kafel);
  }
  return { box, w: szer, h: wys };
}

function kopiuj(tekst, e) {
  navigator.clipboard?.writeText(tekst);
  const t = e.currentTarget;
  t.classList.add("skopiowano");
  setTimeout(() => t.classList.remove("skopiowano"), 700);
}

let numerRysowania = 0;

async function rysujKarty() {
  const nr = ++numerRysowania;
  animowane.clear();
  const p = stan.wybrany;
  const box = $("#karty");
  if (!p) {
    $("#naglowek").replaceChildren();
    box.replaceChildren(el("p", { klasa: "pusto" }, stan.repa.length ? "Wybierz przedmiot z listy po lewej." : "Dodaj repozytorium przyciskiem „+ Dodaj repo” na górze."));
    return;
  }
  $("#naglowek").replaceChildren(el("h2", {}, p.n || p.id), el("code", {}, nazwaRepo(ust.wzorzec) + ": " + p.id));
  const repa = widoczne();
  const karty = await Promise.all(repa.map((r) => karta(r, odpowiednik(r.id))));
  if (nr !== numerRysowania) return;
  box.replaceChildren(...karty.map((k) => k.el));
  // Wspólny rozmiar scen, żeby sprite'y o tej samej skali stały w równych polach.
  const w = Math.max(32, ...karty.map((k) => k.w)), h = Math.max(32, ...karty.map((k) => k.h));
  box.style.setProperty("--scena-w", `${w * ust.zoom}px`);
  box.style.setProperty("--scena-h", `${h * ust.zoom}px`);
  box.style.setProperty("--z", ust.zoom);
  const kolumny = ust.kier === -1 ? 4 : 1;
  box.style.setProperty("--karta-w", `${Math.max(240, kolumny * w * ust.zoom + (kolumny - 1) * 4 + 26)}px`);
}

async function karta(repo, d) {
  const dane = stan.dane.get(repo.id);
  const wzor = repo.id === ust.wzorzec;
  const p = d?.p;
  const glowa = el("header", {},
    el("span", { klasa: "rodzaj " + repo.rodzaj }, repo.rodzaj === "ss14" ? "14" : "13"),
    el("b", {}, repo.nazwa),
    dane.wersja ? el("small", { title: dane.wersja.sha }, dane.wersja.data) : null);
  const k = el("article", { klasa: "karta" + (wzor ? " wzor" : "") + (p ? "" : " pusta") }, glowa);
  let w = 0, h = 0;
  if (!p) {
    k.append(el("div", { klasa: "scena brak tlo-" + ust.tlo }, el("span", {}, d?.jak === "ręcznie: brak" ? "oznaczone: brak odpowiednika" : "nie znaleziono odpowiednika")));
  } else {
    const sceny = [];
    if (ust.widok === "s") sceny.push(await scena(repo.id, p.s));
    else if (ust.widok === "r") {
      sceny.push(await scena(repo.id, p.l, { brak: "brak sprite'a w lewej ręce", tytul: "lewa ręka" }));
      sceny.push(await scena(repo.id, p.p, { brak: "brak sprite'a w prawej ręce", tytul: "prawa ręka" }));
    } else sceny.push(await scena(repo.id, p.w, { brak: "brak sprite'a na postaci" }));
    for (const s of sceny) { k.append(s.box); w = Math.max(w, s.w); h = Math.max(h, s.h); }
    const plik = p.s[0];
    const info = el("div", { klasa: "info" },
      el("div", { klasa: "nazwa" }, p.n || "(bez nazwy)"),
      p.d ? el("p", { klasa: "opisp", title: p.d }, p.d) : null,
      el("code", { klasa: "kopiuj", title: "Kliknij, żeby skopiować", onclick: (e) => kopiuj(p.id, e) }, p.id),
      el("code", { klasa: "kopiuj plik", title: "Plik i stan – kliknij, żeby skopiować ścieżkę", onclick: (e) => kopiuj(plik[0], e) },
        `${plik[0]}`, el("br"), `stan: "${plik[1]}"`, p.s.length > 1 ? ` (+${p.s.length - 1} warstw)` : ""),
    );
    k.append(info);
    const meta = plik[0].endsWith(".rsi") ? await Sprite.plik(repo.id, plik[0]) : null;
    if (meta && (meta.licencja || meta.autorzy)) info.append(el("p", { klasa: "licencja", title: meta.autorzy }, `${meta.licencja}${meta.autorzy ? " · " + meta.autorzy : ""}`));
  }
  const stopka = el("footer", {},
    wzor ? el("span", { klasa: "jak wzor" }, "wzorzec") : el("span", { klasa: "jak " + (d ? (d.jak.startsWith("podobna") ? "slabe" : d.jak.startsWith("ręcznie") || d.jak.startsWith("wybrany") ? "reczne" : "pewne") : "slabe") }, d ? `dopasowanie: ${d.jak}` : "brak"),
    !wzor ? el("button", { klasa: "przycisk maly", onclick: () => otworzWybor(repo) }, "Zmień") : null,
    p ? el("button", { klasa: "przycisk maly", onclick: (e) => przelaczStany(k, repo.id, p, e.currentTarget) }, "Stany pliku") : null,
  );
  k.append(stopka);
  return { el: k, w, h };
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

// ---------------------------------------------------------------- ręczny wybór odpowiednika

let wyborRepo = null;
function otworzWybor(repo) {
  wyborRepo = repo;
  $("#wyborTytul").textContent = `Odpowiednik w ${repo.nazwa} dla „${stan.wybrany.n || stan.wybrany.id}”`;
  $("#wyborSzukaj").value = stan.wybrany.n || "";
  rysujWybor();
  $("#oknoWybor").showModal();
  $("#wyborSzukaj").select();
}

function rysujWybor() {
  const dane = stan.dane.get(wyborRepo.id);
  const wyniki = szukaj(dane.przedmioty, $("#wyborSzukaj").value, "", 200);
  $("#wyborLista").replaceChildren(...wyniki.map((p) => {
    const c = el("canvas", { width: 32, height: 32 });
    rysujMiniature(c, wyborRepo.id, p.s);
    return el("li", { onclick: () => ustawRecznie(p.id) }, c, el("div", { klasa: "opis" }, el("b", {}, p.n || "(bez nazwy)"), el("small", {}, p.id)));
  }));
}

function ustawRecznie(wartosc) {
  const k = kluczRecznych();
  const r = ust.recznie[k] ||= {};
  if (wartosc === undefined) delete r[wyborRepo.id];
  else r[wyborRepo.id] = wartosc;
  if (!Object.keys(r).length) delete ust.recznie[k];
  zapisz();
  $("#oknoWybor").close();
  rysujKarty();
}

$("#wyborSzukaj").addEventListener("input", () => { clearTimeout(rysujWybor._t); rysujWybor._t = setTimeout(rysujWybor, 120); });
$("#wyborAuto").addEventListener("click", () => ustawRecznie(undefined));
$("#wyborBrak").addEventListener("click", () => ustawRecznie(null));
$("#wyborZamknij").addEventListener("click", () => $("#oknoWybor").close());

// ---------------------------------------------------------------- pasek narzędzi

function grupa(sel, atr, klucz, zamien = (x) => x) {
  const przyciski = document.querySelectorAll(`${sel} button`);
  const odswiez = () => przyciski.forEach((b) => b.classList.toggle("aktywny", zamien(b.dataset[atr]) === ust[klucz]));
  przyciski.forEach((b) => b.addEventListener("click", () => { ust[klucz] = zamien(b.dataset[atr]); zapisz(); odswiez(); rysujKarty(); }));
  odswiez();
}
grupa("#widoki", "widok", "widok");
grupa("#kierunki", "kier", "kier", Number);
grupa("#tla", "tlo", "tlo");

$("#zoom").value = ust.zoom;
$("#zoomWartosc").textContent = ust.zoom + "×";
$("#zoom").addEventListener("input", (e) => {
  ust.zoom = +e.target.value; $("#zoomWartosc").textContent = ust.zoom + "×"; zapisz();
  clearTimeout(rysujKarty._t); rysujKarty._t = setTimeout(rysujKarty, 60);
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
  if (e.key === " " && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName) && !document.querySelector("dialog[open]")) {
    e.preventDefault(); przelaczAnimacje();
  }
});
window.addEventListener("hashchange", zHasha);

odswiezRepa();
