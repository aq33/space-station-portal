// Zakładka „HUD”: ikony umiejętności, przycisków, alertów, menu radialnych i znaczników.
//
// Ikony nie mają typów jak przedmioty, więc ten sam element łączę po wyglądzie i nazwie stanu:
// najpierw identyczne piksele, potem ta sama nazwa stanu w tej samej kategorii, na końcu
// podobny wygląd (kształt i jasność) w tej samej kategorii.

import * as Sprite from "./sprite.js";
import { pobierz } from "./zrodlo.js";

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

export const KATEGORIE = [
  { id: "akcje", nazwa: "Umiejętności i akcje" },
  { id: "przyciski", nazwa: "Przyciski i style HUD" },
  { id: "alerty", nazwa: "Alerty" },
  { id: "radial", nazwa: "Menu radialne" },
  { id: "znaczniki", nazwa: "Znaczniki HUD (ochrona, medycyna, antagoniści)" },
  { id: "emotki", nazwa: "Emotki" },
  { id: "inne", nazwa: "Inne" },
];

const OGOLNE = new Set(["", "icon", "base", "background", "bg", "template", "default", "frame", "blank", "empty", "overlay", "border", "hover", "selected"]);

const dane = new Map();
const ladowane = new Map();
let repa = [];
let grupy = [];
let baza = [];
let lista = [];
let pokazane = 0;
let filtrKat = "", filtrPod = "", skala = 2;

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
const dwa = (h) => [parseInt(h.slice(0, 8), 16) >>> 0, parseInt(h.slice(8, 16), 16) >>> 0];
const hamming = (a, b) => popcount((a[0] ^ b[0]) >>> 0) + popcount((a[1] ^ b[1]) >>> 0);
function kolorOdl(a, b) {
  const r = (i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16));
  return (r(1) + r(3) + r(5)) / 765;
}

async function wczytaj(r) {
  if (dane.has(r.id)) return;
  if (!ladowane.has(r.id)) {
    ladowane.set(r.id, pobierz(`/api/hud/${r.id}`).catch(() => ({ ikony: [], brak: true })).then((d) => {
      for (const i of d.ikony) {
        const n = norm(i.n);
        // przyciski HUD mają wiele stylów (screen_midnight, screen_retro…) z tymi samymi nazwami stanów,
        // więc łączę je tylko w obrębie stylu; ogólne nazwy tylko w obrębie pliku
        i._klucz = i.k + "|" + (i.k === "przyciski" || OGOLNE.has(n) || /^\d+$/.test(n) ? norm(i.g) + "/" + n : n);
        i._v = dwa(i.v);
        i._m = dwa(i.m);
      }
      dane.set(r.id, d);
    }));
  }
  await ladowane.get(r.id);
}

function grupuj() {
  const poSkrocie = new Map(), poKluczu = new Map(), pasma = new Map();
  grupy = [];
  for (const r of repa) {
    const d = dane.get(r.id);
    if (!d) continue;
    for (const i of d.ikony) {
      let g = poSkrocie.get(i.h), jak = "identyczny";
      if (!g || g.komorki[r.id]) {
        g = poKluczu.get(i._klucz);
        jak = "ta sama nazwa";
        if (g && g.komorki[r.id]) g = null;
      }
      if (!g) {
        // podobny wygląd w tej samej kategorii (kandydaci z czterech pasm dHash)
        let naj = null, najD = 99;
        for (let p = 0; p < 4; p++) {
          for (const k of pasma.get(i.k + p + i.v.slice(p * 4, p * 4 + 4)) || []) {
            if (k.komorki[r.id]) continue;
            const w = k.wzor;
            const dv = hamming(i._v, w._v), dm = hamming(i._m, w._m);
            if (dv <= 6 && dm <= 8 && kolorOdl(i.c, w.c) < 0.15 && dv + dm < najD) { naj = k; najD = dv + dm; }
          }
        }
        g = naj;
        jak = "podobny wygląd";
      }
      if (!g) {
        g = { komorki: {}, wzor: i };
        grupy.push(g);
        jak = "wzor";
        for (let p = 0; p < 4; p++) {
          const kl = i.k + p + i.v.slice(p * 4, p * 4 + 4);
          let l = pasma.get(kl);
          if (!l) pasma.set(kl, l = []);
          if (l.length < 40) l.push(g);
        }
      } else if (i.h === g.wzor.h) jak = "identyczny";
      g.komorki[r.id] = { i, jak };
      if (!poSkrocie.has(i.h)) poSkrocie.set(i.h, g);
      if (!poKluczu.has(i._klucz)) poKluczu.set(i._klucz, g);
    }
  }
}

export function liczniki(kat) {
  const k = new Map(), pod = new Map();
  for (const g of baza) {
    k.set(g.wzor.k, (k.get(g.wzor.k) || 0) + 1);
    if (g.wzor.k === kat) pod.set(g.wzor.g, (pod.get(g.wzor.g) || 0) + 1);
  }
  return { suma: baza.length, kat: k, pod };
}

export async function pokaz(widoczneRepa, kat = "", pod = "", sk = 2) {
  const zmianaRepo = widoczneRepa.map((r) => r.id).join() !== repa.map((r) => r.id).join();
  repa = widoczneRepa;
  filtrKat = kat; filtrPod = pod; skala = sk;
  document.documentElement.style.setProperty("--kolumny", repa.length);
  const wybor = $("#hudRepo");
  const stary = wybor.value;
  wybor.replaceChildren(...repa.map((r) => el("option", { value: r.id }, r.nazwa)));
  wybor.value = repa.some((r) => r.id === stary) ? stary : repa[0]?.id ?? "";
  $("#hudStopka").textContent = "Wczytuję ikony…";
  await Promise.all(repa.map(wczytaj));
  if (zmianaRepo || !grupy.length) grupuj();
  filtruj();
}

function filtruj() {
  const tryb = $("#hudTryb").value;
  const cel = $("#hudRepo").value;
  $("#hudRepoEtykieta").hidden = tryb !== "nowe";
  const slowa = $("#szukaj").value.toLowerCase().split(/\s+/).filter(Boolean);
  const pasuje = (i) => slowa.every((w) => (i.n + " " + i.s + " " + i.f).toLowerCase().includes(w));
  baza = grupy.filter((g) => {
    const kom = Object.values(g.komorki);
    if (slowa.length && !kom.some((k) => pasuje(k.i))) return false;
    if (tryb === "nowe") return kom.length === 1 && g.komorki[cel];
    if (tryb === "rozne") return kom.length > 1 && kom.some((k) => k.jak !== "identyczny" && k.jak !== "wzor");
    if (tryb === "wspolne") return kom.length === repa.length;
    return true;
  });
  lista = filtrKat ? baza.filter((g) => g.wzor.k === filtrKat && (!filtrPod || g.wzor.g === filtrPod)) : baza;
  pokazane = 0;
  $("#hudNaglowki").replaceChildren(el("div", { klasa: "kom pierwsza" }, "Ikona"),
    ...repa.map((r) => el("div", { klasa: "kom" }, el("span", { klasa: "rodzaj " + r.rodzaj }, r.rodzaj === "ss14" ? "14" : "13"), el("b", {}, r.nazwa),
      dane.get(r.id)?.brak ? el("small", { title: "Indeks ikon jeszcze nie powstał – przeczytaj repo od nowa" }, "brak danych") : null)));
  $("#hudWiersze").replaceChildren();
  dociagnij(80);
}

export function szukajZmienione() { filtruj(); }

function dociagnij(ile) {
  const box = $("#hudWiersze");
  const koniec = Math.min(lista.length, pokazane + ile);
  for (let n = pokazane; n < koniec; n++) box.append(wiersz(lista[n]));
  pokazane = koniec;
  const suma = lista.length.toLocaleString("pl");
  $("#hudStopka").textContent = !lista.length ? "Nic nie znaleziono." : pokazane < lista.length ? `${pokazane} z ${suma}, przewiń po więcej` : `${suma} ikon`;
}
new IntersectionObserver((w) => { if (w[0].isIntersecting && pokazane < lista.length) dociagnij(60); }, { rootMargin: "500px" }).observe($("#hudStopka"));

const OPIS = { wzor: "", identyczny: "identyczna ikona", "ta sama nazwa": "inna wersja (ta sama nazwa stanu)", "podobny wygląd": "podobny wygląd (inna nazwa)" };
const KLASA = { wzor: "", identyczny: "pewne", "ta sama nazwa": "mozliwe", "podobny wygląd": "reczne" };

async function rysuj(canvas, repo, i, rozmiar, kierunek = 0, klatkaCzas = 0) {
  const st = await Sprite.stan(repo, i.f, i.s);
  if (!st) return null;
  let sk = rozmiar / Math.max(st.szer, st.wys);
  if (sk >= 1) sk = Math.floor(sk);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const narysuj = (czas) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Sprite.rysuj(ctx, st, kierunek, Sprite.numerKlatki(st.s, czas), Math.round((canvas.width - st.szer * sk) / 2), Math.round((canvas.height - st.wys * sk) / 2), sk);
  };
  narysuj(klatkaCzas);
  return st.s.klatki > 1 ? narysuj : null;
}

function wiersz(g) {
  const r0 = repa.find((r) => g.komorki[r.id]);
  const w = el("div", { klasa: "wiersz hud", onclick: () => rozwin(g, w) },
    el("div", { klasa: "kom pierwsza" },
      el("b", {}, g.wzor.n || "(bez nazwy)"),
      el("small", { title: g.wzor.f }, `${r0?.nazwa}: ${g.wzor.f.replace(/^.*\//, "")}`),
      el("span", { klasa: "ile" }, `w ${Object.keys(g.komorki).length} z ${repa.length} repo`)));
  const rozmiar = 32 * skala;
  for (const r of repa) {
    const k = g.komorki[r.id];
    if (!k) { w.append(el("div", { klasa: "kom pusta" }, el("span", { klasa: "brak" }, "—"))); continue; }
    const c = el("canvas", { width: rozmiar, height: rozmiar });
    rysuj(c, r.id, k.i, rozmiar);
    w.append(el("div", { klasa: "kom sprite tlo-szachownica", title: `${k.i.n}\n${k.i.f}\nstan: "${k.i.s}"${OPIS[k.jak] ? "\n" + OPIS[k.jak] : ""}` },
      c,
      k.jak !== "wzor" ? el("span", { klasa: "znacznik " + KLASA[k.jak], title: OPIS[k.jak] }) : null,
      k.jak !== "wzor" && norm(k.i.n) !== norm(g.wzor.n) ? el("small", { klasa: "inna-nazwa" }, k.i.n) : null));
  }
  return w;
}

const animowane = new Set();
let start = performance.now();
(function petla() {
  for (const f of animowane) f(performance.now() - start);
  requestAnimationFrame(petla);
})();

function rozwin(g, w) {
  const stary = w.nextElementSibling?.classList.contains("rozwiniecie") ? w.nextElementSibling : null;
  document.querySelectorAll("#hudWiersze .rozwiniecie").forEach((x) => x.remove());
  document.querySelectorAll(".wiersz.hud.otwarty").forEach((x) => x.classList.remove("otwarty"));
  animowane.clear();
  if (stary) return;
  w.classList.add("otwarty");
  const box = el("div", { klasa: "rozwiniecie" });
  for (const r of repa) {
    const k = g.komorki[r.id];
    const karta = el("div", { klasa: "karta-dz" }, el("header", {}, el("span", { klasa: "rodzaj " + r.rodzaj }, r.rodzaj === "ss14" ? "14" : "13"), el("b", {}, r.nazwa)));
    if (!k) { karta.append(el("p", { klasa: "szary" }, "Nie ma tej ikony.")); box.append(karta); continue; }
    const kier = k.i.d > 1 ? [0, 1, 2, 3] : [0];
    const scena = el("div", { klasa: "scena-hud tlo-szachownica" });
    for (const d of kier) {
      const c = el("canvas", { width: 128, height: 128 });
      rysuj(c, r.id, k.i, 128, d).then((f) => { if (f) animowane.add(f); });
      scena.append(c);
    }
    karta.append(...[
      scena,
      el("div", { klasa: "nazwa" }, k.i.n),
      el("code", { klasa: "kopiuj", title: "Kliknij, żeby skopiować ścieżkę pliku", onclick: (e) => { navigator.clipboard?.writeText(k.i.f); e.currentTarget.classList.add("skopiowano"); } }, k.i.f),
      el("p", { klasa: "szary" }, [`stan: "${k.i.s}"`, `${k.i.r[0]}×${k.i.r[1]} px`, k.i.d > 1 ? `${k.i.d} kierunki` : "", k.i.a > 1 ? `${k.i.a} klatek animacji` : "", OPIS[k.jak]].filter(Boolean).join(" · ")),
    ].filter(Boolean));
    box.append(karta);
  }
  w.after(box);
}
