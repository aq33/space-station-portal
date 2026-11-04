// Szukanie „tego samego przedmiotu” w innym repozytorium.
//
// Kolejność: ta sama ścieżka typu (SS13↔SS13, po zdjęciu /weapon i /device ze
// starszych baz), ta sama nazwa, ten sam identyfikator (ostatni człon ścieżki albo
// id prototypu SS14), a na końcu podobna nazwa w tej samej kategorii.

const POMIJANE_CZLONY = new Set(["weapon", "device"]);

export function normSciezka(id) {
  if (!id.startsWith("/")) return null;
  return id.toLowerCase().split("/").filter((c) => c && !POMIJANE_CZLONY.has(c)).join("/");
}

export function normNazwa(n) {
  return (n || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/^(the|a|an) /, "").replace(/['’]s\b/g, "s").replace(/[^a-z0-9]+/g, " ").trim();
}

export function lisc(id) {
  const ostatni = id.startsWith("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return ostatni.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function slowa(n) {
  return new Set(normNazwa(n).split(" ").filter((s) => s.length > 1));
}

// Indeks pomocniczy jednego repozytorium.
export function przygotuj(repo) {
  const poSciezce = new Map(), poNazwie = new Map(), poLisciu = new Map(), poId = new Map();
  const dodaj = (m, k, p) => { if (!k) return; let l = m.get(k); if (!l) m.set(k, l = []); l.push(p); };
  for (const p of repo.przedmioty) {
    poId.set(p.id, p);
    p._nazwa = normNazwa(p.n);
    p._lisc = lisc(p.id);
    const s = normSciezka(p.id);
    if (s && !poSciezce.has(s)) poSciezce.set(s, p);
    dodaj(poNazwie, p._nazwa, p);
    dodaj(poLisciu, p._lisc, p);
  }
  repo.poSciezce = poSciezce; repo.poNazwie = poNazwie; repo.poLisciu = poLisciu; repo.poId = poId;
}

// Słowa identyfikatora: człony ścieżki SS13 i wyrazy PascalCase z id SS14.
function tokenyId(id) {
  return new Set(id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((s) => s.length > 1 && s !== "obj" && s !== "item"));
}

function wspolneCzlony(a, b) {
  const x = a._tokeny ??= tokenyId(a.id);
  const y = b._tokeny ??= tokenyId(b.id);
  let n = 0;
  for (const c of y) if (x.has(c)) n++;
  return n;
}

// Spośród kandydatów wybiera najbliższego wzorcowi.
function najlepszy(wzor, kandydaci) {
  if (kandydaci.length === 1) return kandydaci[0];
  let naj = null, punkty = -Infinity;
  for (const k of kandydaci) {
    let p = 0;
    if (k.k === wzor.k) p += 10;
    if (k._lisc === wzor._lisc) p += 6;
    if (k._nazwa === wzor._nazwa) p += 4;
    p += wspolneCzlony(wzor, k);
    p -= k.id.length / 200;   // przy remisie krótsza (bardziej ogólna) ścieżka
    if (p > punkty) { punkty = p; naj = k; }
  }
  return naj;
}

// Szybkie dopasowanie (bez podobnych nazw) – do liczenia odpowiedników na liście.
export function dopasujDokladnie(wzor, cel) {
  const s = normSciezka(wzor.id);
  if (s && cel.poSciezce.has(s)) return { p: cel.poSciezce.get(s), jak: "ścieżka" };
  const n = wzor._nazwa && wzor._nazwa.length > 2 ? cel.poNazwie.get(wzor._nazwa) : null;
  if (n) return { p: najlepszy(wzor, n), jak: "nazwa" };
  const l = wzor._lisc && wzor._lisc.length > 3 ? cel.poLisciu.get(wzor._lisc) : null;
  if (l) return { p: najlepszy(wzor, l), jak: "identyfikator" };
  return null;
}

// Pełne dopasowanie: jak wyżej, a na końcu podobieństwo słów nazwy w tej samej kategorii.
export function dopasuj(wzor, cel) {
  const d = dopasujDokladnie(wzor, cel);
  if (d) return d;
  const w = slowa(wzor.n);
  if (!w.size) return null;
  let naj = null, wynik = 0;
  for (const p of cel.przedmioty) {
    if (p.k !== wzor.k) continue;
    const s = p._slowa ??= slowa(p.n);
    if (!s.size) continue;
    let wspolne = 0;
    for (const x of w) if (s.has(x)) wspolne++;
    if (!wspolne) continue;
    const j = wspolne / (w.size + s.size - wspolne);
    if (j > wynik || (j === wynik && naj && p.id.length < naj.id.length)) { wynik = j; naj = p; }
  }
  if (naj && wynik >= 0.5) return { p: naj, jak: `podobna nazwa ${Math.round(wynik * 100)}%` };
  return null;
}

// Wyszukiwanie po nazwie lub ścieżce/id (wszystkie słowa zapytania muszą wystąpić).
export function szukaj(przedmioty, zapytanie, kategoria, limit = Infinity) {
  const slowaZap = zapytanie.toLowerCase().split(/\s+/).filter(Boolean);
  const wynik = [];
  for (const p of przedmioty) {
    if (kategoria && p.k !== kategoria) continue;
    if (slowaZap.length) {
      const tekst = p._szukaj ??= (p.n + " " + p.id).toLowerCase();
      if (!slowaZap.every((s) => tekst.includes(s))) continue;
    }
    wynik.push(p);
    if (wynik.length >= limit) break;
  }
  return wynik;
}
