// Szukanie „tego samego przedmiotu” w innym repozytorium.
//
// Kandydatów zbieramy z kilku źródeł (ta sama ścieżka po regułach UpdatePaths, nazwa,
// opis, identyczny albo podobny wygląd), a potem każdemu liczymy punkty za wszystkie
// włączone kryteria naraz. Wygrywa kandydat z największą liczbą punktów.

export const KRYTERIA = {
  wyglad: "wygląd",
  nazwa: "nazwa",
  opis: "opis",
  sciezka: "ścieżka",
};

export const PROG_PEWNE = 45;
export const PROG_MOZLIWE = 25;

const POMIJANE_CZLONY = new Set(["weapon", "device"]);
const SLOWA_POMIJANE = new Set(["the", "a", "an", "of", "and", "with", "for", "in", "on", "to"]);

let reguly = { dokladne: {}, podtypy: {}, odwrotne: {}, odwrotnePod: {} };

export function ustawReguly(r) {
  const odwrotne = {}, odwrotnePod = {};
  for (const [a, b] of Object.entries(r.dokladne || {})) odwrotne[b] ??= a;
  for (const [a, b] of Object.entries(r.podtypy || {})) odwrotnePod[b] ??= a;
  reguly = { dokladne: r.dokladne || {}, podtypy: r.podtypy || {}, odwrotne, odwrotnePod };
}

function przepisz(sciezka, dokladne, podtypy) {
  if (dokladne[sciezka]) return dokladne[sciezka];
  let i = sciezka.length;
  while (i > 0) {
    const przodek = sciezka.slice(0, i);
    if (podtypy[przodek]) return podtypy[przodek] + sciezka.slice(i);
    i = sciezka.lastIndexOf("/", i - 1);
  }
  return null;
}

// Ścieżki równoważne według reguł UpdatePaths, w obie strony (bazy zmieniały nazwy w różne strony).
export function warianty(sciezka) {
  const wynik = [sciezka];
  const widziane = new Set(wynik);
  for (let i = 0; i < wynik.length && wynik.length < 8; i++) {
    for (const [d, p] of [[reguly.dokladne, reguly.podtypy], [reguly.odwrotne, reguly.odwrotnePod]]) {
      const n = przepisz(wynik[i], d, p);
      if (n && !widziane.has(n)) { widziane.add(n); wynik.push(n); }
    }
  }
  return wynik;
}

export function normSciezka(id) {
  if (!id.startsWith("/")) return null;
  return id.toLowerCase().split("/").filter((c) => c && !POMIJANE_CZLONY.has(c)).join("/");
}

export function normTekst(n) {
  return (n || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/['’]s\b/g, "s").replace(/[^a-z0-9]+/g, " ").trim();
}

export function normNazwa(n) {
  return normTekst(n).replace(/^(the|a|an) /, "");
}

function slowa(tekst) {
  return new Set(normTekst(tekst).split(" ").filter((s) => s.length > 1 && !SLOWA_POMIJANE.has(s)));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let w = 0;
  for (const x of a) if (b.has(x)) w++;
  return w / (a.size + b.size - w);
}

// Słowa identyfikatora: człony ścieżki SS13 i wyrazy PascalCase z id SS14.
function tokenyId(id) {
  return new Set(id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/)
    .filter((s) => s.length > 1 && s !== "obj" && s !== "item"));
}

function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function hexNa2(h) {
  return h ? [parseInt(h.slice(0, 8), 16) >>> 0, parseInt(h.slice(8, 16), 16) >>> 0] : null;
}

function hamming(a, b) {
  return popcount((a[0] ^ b[0]) >>> 0) + popcount((a[1] ^ b[1]) >>> 0);
}

function kolorOdl(a, b) {
  if (!a || !b) return 1;
  const r = (i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16));
  return (r(1) + r(3) + r(5)) / 765;
}

const dodaj = (m, k, p) => { if (!k) return; let l = m.get(k); if (!l) m.set(k, l = []); l.push(p); };

// Indeks pomocniczy jednego repozytorium.
export function przygotuj(repo) {
  const m = {
    poId: new Map(), poSciezce: new Map(), poNazwie: new Map(), poOpisie: new Map(),
    poObrazie: new Map(), pasma: [new Map(), new Map(), new Map(), new Map()], poSlowie: new Map(),
  };
  for (const p of repo.przedmioty) {
    m.poId.set(p.id, p);
    p._nazwa = normNazwa(p.n);
    p._slowa = slowa(p.n);
    p._opis = p.d && p.d.length > 24 ? normTekst(p.d) : "";
    p._v = hexNa2(p.v);
    p._m = hexNa2(p.m);
    const s = normSciezka(p.id);
    if (s) dodaj(m.poSciezce, s, p);
    dodaj(m.poNazwie, p._nazwa, p);
    if (p._opis) dodaj(m.poOpisie, p._opis, p);
    if (p.h) dodaj(m.poObrazie, p.h, p);
    if (p.v) for (let i = 0; i < 4; i++) dodaj(m.pasma[i], p.v.slice(i * 4, i * 4 + 4), p);
    for (const w of p._slowa) dodaj(m.poSlowie, w, p);
  }
  repo.m = m;
}

// Warianty ścieżki wzorca, liczone raz na przedmiot.
function sciezkiWzorca(p) {
  if (p._warianty === undefined) {
    p._warianty = p.id.startsWith("/") ? [...new Set(warianty(p.id).map(normSciezka))] : [];
  }
  return p._warianty;
}

function kandydaci(wzor, cel, kryteria) {
  const m = cel.m;
  const zbior = new Set();
  const wez = (lista, limit = 60) => { if (lista && lista.length <= limit) for (const x of lista) zbior.add(x); };
  if (kryteria.sciezka) for (const s of sciezkiWzorca(wzor)) wez(m.poSciezce.get(s));
  if (kryteria.nazwa) {
    wez(m.poNazwie.get(wzor._nazwa), 200);
    // dwa najrzadsze słowa nazwy – kandydaci do „podobnej nazwy”
    const rzadkie = [...wzor._slowa].map((w) => [w, m.poSlowie.get(w)?.length ?? 0]).filter((x) => x[1]).sort((a, b) => a[1] - b[1]).slice(0, 2);
    for (const [w] of rzadkie) wez(m.poSlowie.get(w), 150);
  }
  if (kryteria.opis && wzor._opis) wez(m.poOpisie.get(wzor._opis), 100);
  if (kryteria.wyglad && wzor.v) {
    wez(m.poObrazie.get(wzor.h), 100);
    for (let i = 0; i < 4; i++) wez(m.pasma[i].get(wzor.v.slice(i * 4, i * 4 + 4)), 120);
  }
  return zbior;
}

// Punkty i powody dla jednej pary.
export function ocen(wzor, k, kryteria) {
  let pkt = 0;
  const powody = [];
  if (kryteria.wyglad && wzor.h && k.h) {
    if (wzor.h === k.h) { pkt += 50; powody.push("identyczny wygląd"); }
    else if (wzor._v && k._v) {
      const dv = hamming(wzor._v, k._v), dm = hamming(wzor._m, k._m);
      const kol = kolorOdl(wzor.c, k.c);
      if (dv <= 10 && dm <= 14) {
        const p = Math.round(32 * (1 - dv / 14) * (1 - dm / 28) * (1 - Math.min(kol, 0.5)));
        if (p >= 8) { pkt += p; powody.push(dv <= 4 && kol < 0.08 ? "prawie ten sam wygląd" : "podobny wygląd"); }
      }
    }
  }
  if (kryteria.nazwa && wzor._nazwa) {
    if (wzor._nazwa === k._nazwa) { pkt += 30; powody.push("ta sama nazwa"); }
    else {
      const j = jaccard(wzor._slowa, k._slowa);
      if (j >= 0.5) { pkt += Math.round(24 * j); powody.push("podobna nazwa"); }
    }
  }
  if (kryteria.opis && wzor._opis && k._opis) {
    if (wzor._opis === k._opis) { pkt += 30; powody.push("ten sam opis"); }
    else {
      const a = wzor._slowaOpisu ??= slowa(wzor.d), b = k._slowaOpisu ??= slowa(k.d);
      const j = jaccard(a, b);
      if (j >= 0.5) { pkt += Math.round(22 * j); powody.push("podobny opis"); }
    }
  }
  if (kryteria.sciezka) {
    const s = normSciezka(k.id);
    const w = sciezkiWzorca(wzor);
    if (s && w.includes(s)) { pkt += 40; powody.push(w[0] === s ? "ta sama ścieżka" : "ścieżka po zmianie nazwy"); }
    else {
      const a = wzor._tokeny ??= tokenyId(wzor.id), b = k._tokeny ??= tokenyId(k.id);
      let wspolne = 0;
      for (const x of b) if (a.has(x)) wspolne++;
      pkt += Math.min(8, wspolne * 1.5);
    }
  }
  if (pkt > 0 && wzor.k === k.k) pkt += 4;
  pkt -= k.id.length / 400;   // przy remisie krótsza (bardziej ogólna) ścieżka
  return { p: k, pkt, powody };
}

// Lista propozycji od najlepszej. Pierwsza jest dopasowaniem, jeśli ma co najmniej PROG_MOZLIWE.
export function propozycje(wzor, cel, kryteria, ile = 4) {
  const wynik = [];
  for (const k of kandydaci(wzor, cel, kryteria)) {
    const o = ocen(wzor, k, kryteria);
    if (o.powody.length) wynik.push(o);
  }
  wynik.sort((a, b) => b.pkt - a.pkt);
  return wynik.slice(0, ile);
}

export function dopasuj(wzor, cel, kryteria) {
  const [n] = propozycje(wzor, cel, kryteria, 1);
  return n && n.pkt >= PROG_MOZLIWE ? n : null;
}

// Wyszukiwanie: wszystkie słowa zapytania muszą wystąpić w nazwie albo ścieżce/id.
// Wyniki są ułożone: najpierw dokładna nazwa, potem nazwa zawierająca zapytanie, potem reszta.
export function szukaj(przedmioty, zapytanie, kategoria, limit = Infinity) {
  const zap = zapytanie.toLowerCase().trim();
  const slowaZap = zap.split(/\s+/).filter(Boolean);
  if (!slowaZap.length) {
    const w = kategoria ? przedmioty.filter((p) => p.k === kategoria) : przedmioty;
    return limit < w.length ? w.slice(0, limit) : w;
  }
  const grupy = [[], [], []];
  for (const p of przedmioty) {
    if (kategoria && p.k !== kategoria) continue;
    const tekst = p._szukaj ??= (p.n + " " + p.id).toLowerCase();
    if (!slowaZap.every((s) => tekst.includes(s))) continue;
    const n = (p.n || "").toLowerCase();
    grupy[n === zap ? 0 : n.includes(zap) ? 1 : 2].push(p);
  }
  const wynik = grupy.flat();
  return limit < wynik.length ? wynik.slice(0, limit) : wynik;
}
