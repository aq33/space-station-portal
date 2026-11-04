// Zakładka „Dźwięki”: te same dźwięki w różnych repo, nowe dźwięki i miejsca użycia w kodzie.
//
// Grupowanie: najpierw identyczna zawartość (skrót pliku), potem ta sama ścieżka względna
// (bez sound/ albo Resources/Audio/, bez rozszerzenia, bez wielkości liter), na końcu sama
// nazwa pliku. Pierwszy plik w grupie jest wzorcem: identyczny = zielony, inna wersja = żółty.

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

const dane = new Map();      // id repo -> {dzwieki, brakujace}
const ladowane = new Map();  // id repo -> Promise
let repa = [];               // widoczne repo z main.js
let grupy = [];
let lista = [];
let pokazane = 0;
let rozwiniety = null;
const odtwarzacz = new Audio();
let grajacy = null;

export function klucz(p) {
  let s = p.toLowerCase();
  const i = s.indexOf("resources/audio/");
  if (i >= 0) s = s.slice(i + 16);
  else {
    const j = s.lastIndexOf("sound/");
    if (j >= 0) s = s.slice(j + 6);
  }
  return s.replace(/\.[a-z0-9]+$/, "");
}

const pien = (p) => p.toLowerCase().replace(/^.*\//, "").replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]/g, "");

import { urlPliku, pobierz } from "./zrodlo.js";
import { przypiszDzwiek } from "./kategorie.js";

let filtrKat = "", filtrPod = "";
let baza = [];   // pozycje po trybie i wyszukiwaniu, przed kategorią (do liczników w kolumnie kategorii)

const katPozycji = (x) => (x.brak ? x.brak : x.wzor);

// Liczniki kategorii i podgrup dla kolumny po lewej.
export function liczniki(kat) {
  const k = new Map(), pod = new Map();
  for (const x of baza) {
    const s = katPozycji(x);
    k.set(s._kat, (k.get(s._kat) || 0) + 1);
    if (s._kat === kat) pod.set(s._pod, (pod.get(s._pod) || 0) + 1);
  }
  return { suma: baza.length, kat: k, pod };
}

function rozmiar(b) {
  return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} kB`;
}

function czas(t) {
  if (t === undefined) return "";
  return t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}` : `${t.toFixed(1)} s`;
}

async function wczytaj(r) {
  if (dane.has(r.id)) return;
  if (!ladowane.has(r.id)) {
    ladowane.set(r.id, pobierz(`/api/dzwieki/${r.id}`).catch(() => ({ dzwieki: [], brakujace: [], brak: true })).then((d) => {
      for (const s of d.dzwieki) { s._k = klucz(s.p); s._pien = pien(s.p); przypiszDzwiek(s); }
      for (const b of d.brakujace || []) przypiszDzwiek(b);
      dane.set(r.id, d);
    }));
  }
  await ladowane.get(r.id);
}

function grupuj() {
  const poSkrocie = new Map(), poKluczu = new Map(), poPniu = new Map();
  grupy = [];
  for (const r of repa) {
    const d = dane.get(r.id);
    if (!d) continue;
    for (const s of d.dzwieki) {
      let g = poSkrocie.get(s.h);
      let jak = "identyczny";
      if (!g || g.komorki[r.id]) {
        g = poKluczu.get(s._k);
        jak = "ta sama ścieżka";
        if (!g || g.komorki[r.id]) {
          g = poPniu.get(s._pien);
          jak = "ta sama nazwa pliku";
          if (g && g.komorki[r.id]) g = null;
        }
      }
      if (!g) {
        g = { komorki: {}, wzor: s, repoWzoru: r.id };
        grupy.push(g);
        jak = "wzor";
      }
      if (jak !== "wzor" && s.h === g.wzor.h) jak = "identyczny";
      g.komorki[r.id] = { s, jak };
      if (!poSkrocie.has(s.h)) poSkrocie.set(s.h, g);
      if (!poKluczu.has(s._k)) poKluczu.set(s._k, g);
      if (!poPniu.has(s._pien)) poPniu.set(s._pien, g);
    }
  }
}

export async function pokaz(widoczneRepa, kat = "", pod = "") {
  repa = widoczneRepa;
  filtrKat = kat;
  filtrPod = pod;
  document.documentElement.style.setProperty("--kolumny", repa.length);
  const wybor = $("#dzRepo");
  const stary = wybor.value;
  wybor.replaceChildren(...repa.map((r) => el("option", { value: r.id }, r.nazwa)));
  wybor.value = repa.some((r) => r.id === stary) ? stary : repa[0]?.id ?? "";
  $("#dzwiekiStopka").textContent = "Wczytuję dźwięki…";
  await Promise.all(repa.map(wczytaj));
  grupuj();
  filtruj();
}

function filtruj() {
  const tryb = $("#dzTryb").value;
  const cel = $("#dzRepo").value;
  $("#dzRepoEtykieta").hidden = tryb === "wszystkie" || tryb === "rozne";
  const slowa = $("#szukaj").value.toLowerCase().split(/\s+/).filter(Boolean);
  const pasuje = (sciezka) => slowa.every((w) => sciezka.toLowerCase().includes(w));
  rozwiniety = null;
  if (tryb === "brakujace") {
    lista = (dane.get(cel)?.brakujace || []).filter((b) => pasuje(b.p)).map((b) => ({ brak: b }));
  } else {
    lista = grupy.filter((g) => {
      const ile = Object.keys(g.komorki).length;
      if (slowa.length && !Object.values(g.komorki).some((k) => pasuje(k.s.p))) return false;
      if (tryb === "nowe") return ile === 1 && g.komorki[cel];
      if (tryb === "rozne") return ile > 1 && Object.values(g.komorki).some((k) => k.jak !== "identyczny" && k.jak !== "wzor");
      if (tryb === "nieuzywane") return g.komorki[cel] && !g.komorki[cel].s.n;
      if (tryb === "uzywane") return g.komorki[cel] && g.komorki[cel].s.n;
      return true;
    });
  }
  baza = lista;
  if (filtrKat) lista = lista.filter((x) => katPozycji(x)._kat === filtrKat && (!filtrPod || katPozycji(x)._pod === filtrPod));
  pokazane = 0;
  rysujNaglowki(tryb);
  $("#dzwiekiWiersze").replaceChildren();
  dociagnij(80);
}

function rysujNaglowki(tryb) {
  const box = $("#dzwiekiNaglowki");
  if (tryb === "brakujace") {
    box.className = "wiersz naglowki brakujace";
    box.replaceChildren(el("div", { klasa: "kom pierwsza" }, "Odwołanie w kodzie do pliku, którego nie ma"), el("div", { klasa: "kom" }, "Gdzie"));
    return;
  }
  box.className = "wiersz naglowki";
  box.replaceChildren(el("div", { klasa: "kom pierwsza" }, "Dźwięk"),
    ...repa.map((r) => el("div", { klasa: "kom" }, el("span", { klasa: "rodzaj " + r.rodzaj }, r.rodzaj === "ss14" ? "14" : "13"), el("b", {}, r.nazwa),
      dane.get(r.id)?.brak ? el("small", { title: "Indeks dźwięków jeszcze nie powstał – przeczytaj repo od nowa" }, "brak danych") : null)));
}

function dociagnij(ile) {
  const box = $("#dzwiekiWiersze");
  const koniec = Math.min(lista.length, pokazane + ile);
  for (let i = pokazane; i < koniec; i++) box.append(lista[i].brak ? wierszBraku(lista[i].brak) : wiersz(lista[i], i));
  pokazane = koniec;
  const suma = lista.length.toLocaleString("pl");
  $("#dzwiekiStopka").textContent = !lista.length ? "Nic nie znaleziono." : pokazane < lista.length ? `${pokazane} z ${suma}, przewiń po więcej` : `${suma} pozycji`;
}

new IntersectionObserver((w) => { if (w[0].isIntersecting && pokazane < lista.length) dociagnij(60); }, { rootMargin: "500px" }).observe($("#dzwiekiStopka"));

function graj(repo, s, przycisk) {
  if (grajacy === przycisk) {
    odtwarzacz.pause();
    przycisk.classList.remove("gra");
    grajacy = null;
    return;
  }
  grajacy?.classList.remove("gra");
  odtwarzacz.src = urlPliku(repo, s.p);
  odtwarzacz.play().catch(() => {});
  przycisk.classList.add("gra");
  grajacy = przycisk;
}
odtwarzacz.addEventListener("ended", () => { grajacy?.classList.remove("gra"); grajacy = null; });

const OPIS = { wzor: "", identyczny: "identyczny plik", "ta sama ścieżka": "inna wersja (ta sama ścieżka)", "ta sama nazwa pliku": "inna wersja (ta sama nazwa pliku)" };
const KLASA = { wzor: "", identyczny: "pewne", "ta sama ścieżka": "mozliwe", "ta sama nazwa pliku": "mozliwe" };

function wiersz(g, i) {
  const w = el("div", { klasa: "wiersz dzwiek", onclick: () => przelacz(g, w) },
    el("div", { klasa: "kom pierwsza" },
      el("b", {}, g.wzor.p.replace(/^.*\//, "")),
      el("small", { title: g.wzor.p }, g.wzor.p.replace(/\/[^/]*$/, "/")),
      el("span", { klasa: "ile" }, `w ${Object.keys(g.komorki).length} z ${repa.length} repo`)));
  for (const r of repa) {
    const k = g.komorki[r.id];
    if (!k) { w.append(el("div", { klasa: "kom pusta" }, el("span", { klasa: "brak" }, "—"))); continue; }
    const przycisk = el("button", { klasa: "graj", title: "Odtwórz", onclick: (e) => { e.stopPropagation(); graj(r.id, k.s, przycisk); } }, "▶");
    w.append(el("div", { klasa: "kom dz", title: `${k.s.p}\n${rozmiar(k.s.b)}${k.s.t !== undefined ? ", " + czas(k.s.t) : ""}${OPIS[k.jak] ? "\n" + OPIS[k.jak] : ""}` },
      przycisk,
      el("div", { klasa: "dane" },
        el("span", {}, czas(k.s.t) || rozmiar(k.s.b)),
        el("small", { klasa: k.s.n ? "" : "nieuzywany" }, k.s.n ? `użyty ${k.s.n}×` : "nieużywany")),
      k.jak !== "wzor" ? el("span", { klasa: "znacznik " + KLASA[k.jak], title: OPIS[k.jak] }) : null));
  }
  return w;
}

function wierszBraku(b) {
  const r = repa.find((x) => x.id === $("#dzRepo").value);
  return el("div", { klasa: "wiersz brakujace" },
    el("div", { klasa: "kom pierwsza" }, el("b", {}, b.p), el("span", { klasa: "ile" }, `${b.n} odwołań`)),
    el("div", { klasa: "kom lewo" }, listaUzyc(r, { u: b.u, n: b.n })));
}

function linkKodu(r, plik, linia) {
  const d = window.__repoInfo?.(r.id);
  const github = r.github || d?.github;
  const sha = r.github_sha || d?.wersja?.sha;
  if (github && sha) return `${github}/blob/${sha}/${plik.split("/").map(encodeURIComponent).join("/")}#L${linia}`;
  return null;
}

function listaUzyc(r, s) {
  if (!s.u?.length) return el("p", { klasa: "szary" }, "Kod nie odwołuje się do tego pliku wprost (może być użyty przez ścieżkę składaną w kodzie albo wcale).");
  const ul = el("ul", { klasa: "uzycia" });
  for (const [plik, linia, tekst, przez] of s.u) {
    const url = linkKodu(r, plik, linia);
    ul.append(el("li", {},
      url ? el("a", { href: url, target: "_blank", rel: "noopener" }, `${plik}:${linia}`) : el("code", {}, `${plik}:${linia}`),
      przez ? el("small", { klasa: "przez" }, ` przez kolekcję ${przez}`) : null,
      el("code", { klasa: "linia" }, tekst)));
  }
  if (s.n > s.u.length) ul.append(el("li", { klasa: "szary" }, `…i jeszcze ${s.n - s.u.length}`));
  return ul;
}

function przelacz(g, w) {
  const stary = w.nextElementSibling?.classList.contains("rozwiniecie") ? w.nextElementSibling : null;
  document.querySelectorAll(".rozwiniecie").forEach((x) => x.remove());
  document.querySelectorAll(".wiersz.dzwiek.otwarty").forEach((x) => x.classList.remove("otwarty"));
  if (stary) return;
  w.classList.add("otwarty");
  const box = el("div", { klasa: "rozwiniecie" });
  for (const r of repa) {
    const k = g.komorki[r.id];
    const karta = el("div", { klasa: "karta-dz" }, el("header", {}, el("span", { klasa: "rodzaj " + r.rodzaj }, r.rodzaj === "ss14" ? "14" : "13"), el("b", {}, r.nazwa)));
    if (!k) { karta.append(el("p", { klasa: "szary" }, "Nie ma tego dźwięku.")); box.append(karta); continue; }
    const fala = el("canvas", { klasa: "fala", width: 600, height: 60 });
    rysujFale(fala, urlPliku(r.id, k.s.p));
    karta.append(...[
      el("audio", { controls: true, preload: "none", src: urlPliku(r.id, k.s.p) }),
      fala,
      el("code", { klasa: "kopiuj", title: "Kliknij, żeby skopiować", onclick: (e) => { navigator.clipboard?.writeText(k.s.p); e.currentTarget.classList.add("skopiowano"); } }, k.s.p),
      el("p", { klasa: "szary" }, [rozmiar(k.s.b), czas(k.s.t), OPIS[k.jak]].filter(Boolean).join(" · ")),
      k.s.l ? el("p", { klasa: "licencja" }, k.s.l, k.s.z ? el("a", { href: k.s.z, target: "_blank", rel: "noopener" }, " źródło") : null) : null,
      k.s.c ? el("p", { klasa: "szary" }, `W kolekcjach: ${k.s.c.join(", ")}`) : null,
      el("h4", {}, k.s.n ? `Gdzie używa (${k.s.n})` : "Gdzie używa"),
      listaUzyc(r, k.s)].filter(Boolean));
    box.append(karta);
  }
  w.after(box);
}

// Kształt fali (szczyty głośności) z dekodowanego pliku.
async function rysujFale(canvas, url) {
  try {
    const bufor = await (await fetch(url)).arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const audio = await ctx.decodeAudioData(bufor);
    const kanal = audio.getChannelData(0);
    const c = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const krok = Math.max(1, Math.floor(kanal.length / w));
    c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--akcent") || "#5aa9ff";
    for (let x = 0; x < w; x++) {
      let max = 0;
      for (let i = x * krok; i < (x + 1) * krok && i < kanal.length; i++) max = Math.max(max, Math.abs(kanal[i]));
      const y = Math.max(1, max * h);
      c.fillRect(x, (h - y) / 2, 1, y);
    }
  } catch {
    canvas.remove();
  }
}

for (const s of ["#dzTryb", "#dzRepo"]) document.addEventListener("change", (e) => { if (e.target.matches(s)) filtruj(); });
export function szukajZmienione() { filtruj(); }
