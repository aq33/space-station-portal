// Wczytywanie i rysowanie sprite'ów: .dmi (BYOND) i .rsi (SS14).
//
// .dmi to PNG z opisem stanów w bloku zTXt/tEXt "Description". Klatki leżą w siatce
// wierszami: dla każdej klatki animacji kolejno wszystkie kierunki.
// .rsi to folder z meta.json i jednym PNG na stan. W PNG stanu leżą najpierw wszystkie
// klatki pierwszego kierunku, potem drugiego itd.
// Kolejność kierunków jest w obu taka sama: S, N, E, W, SE, SW, NE, NW.

export const KIERUNKI = { S: 0, N: 1, E: 2, W: 3, SE: 4, SW: 5, NE: 6, NW: 7 };

const pliki = new Map();   // klucz -> Promise<Plik|null>

async function rozpakuj(dane) {
  const strumien = new Blob([dane]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new TextDecoder().decode(await new Response(strumien).arrayBuffer());
}

async function opisPng(bufor) {
  const v = new DataView(bufor);
  let i = 8;
  while (i + 8 <= bufor.byteLength) {
    const dlugosc = v.getUint32(i);
    const typ = String.fromCharCode(v.getUint8(i + 4), v.getUint8(i + 5), v.getUint8(i + 6), v.getUint8(i + 7));
    const dane = new Uint8Array(bufor, i + 8, dlugosc);
    if (typ === "zTXt" || typ === "tEXt") {
      const zero = dane.indexOf(0);
      const klucz = new TextDecoder().decode(dane.subarray(0, zero));
      if (klucz === "Description") {
        if (typ === "tEXt") return new TextDecoder().decode(dane.subarray(zero + 1));
        return rozpakuj(dane.subarray(zero + 2));
      }
    }
    if (typ === "IEND") break;
    i += 12 + dlugosc;
  }
  return null;
}

function napis(w) {
  w = w.trim();
  if (w.startsWith('"') && w.endsWith('"')) {
    try { return JSON.parse(w); } catch { return w.slice(1, -1); }
  }
  return w;
}

function parsujDmi(tekst) {
  const wynik = { szer: 32, wys: 32, stany: new Map(), kolejnosc: [] };
  let indeks = 0;
  let stan = null;
  const zamknij = () => {
    if (!stan) return;
    stan.indeks = indeks;
    indeks += stan.kierunki * stan.klatki;
    if (!stan.opoznienia.length) stan.opoznienia = Array(stan.klatki).fill(100);
    while (stan.opoznienia.length < stan.klatki) stan.opoznienia.push(100);
    // Pierwszy stan o danej nazwie wygrywa – tak samo robi BYOND.
    if (!wynik.stany.has(stan.nazwa)) { wynik.stany.set(stan.nazwa, stan); wynik.kolejnosc.push(stan.nazwa); }
  };
  for (const linia of tekst.split("\n")) {
    const m = linia.trim().match(/^(\w+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, klucz, wartosc] = m;
    if (klucz === "width") wynik.szer = +wartosc;
    else if (klucz === "height") wynik.wys = +wartosc;
    else if (klucz === "state") {
      zamknij();
      stan = { nazwa: napis(wartosc), kierunki: 1, klatki: 1, opoznienia: [], wstecz: false };
    } else if (stan && klucz === "dirs") stan.kierunki = +wartosc;
    else if (stan && klucz === "frames") stan.klatki = +wartosc;
    else if (stan && klucz === "delay") stan.opoznienia = wartosc.split(",").map((x) => Math.max(10, (+x || 1) * 100));
    else if (stan && klucz === "rewind") stan.wstecz = wartosc.trim() === "1";
  }
  zamknij();
  return wynik;
}

async function pobierz(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r;
}

function urlPliku(repo, sciezka) {
  return `/plik/${repo}/${sciezka.split("/").map(encodeURIComponent).join("/")}`;
}

async function wczytajDmi(repo, sciezka) {
  const bufor = await (await pobierz(urlPliku(repo, sciezka))).arrayBuffer();
  const opis = await opisPng(bufor);
  const obraz = await createImageBitmap(new Blob([bufor], { type: "image/png" }));
  let meta;
  if (opis) meta = parsujDmi(opis);
  else {
    meta = { szer: obraz.width, wys: obraz.height, stany: new Map(), kolejnosc: [""] };
    meta.stany.set("", { nazwa: "", kierunki: 1, klatki: 1, opoznienia: [100], indeks: 0 });
  }
  const kolumny = Math.max(1, Math.floor(obraz.width / meta.szer));
  for (const s of meta.stany.values()) s.obraz = obraz, s.kolumny = kolumny;
  return { rodzaj: "dmi", ...meta, rozmiar: bufor.byteLength };
}

async function wczytajRsi(repo, sciezka) {
  const m = await (await pobierz(urlPliku(repo, sciezka + "/meta.json"))).json();
  const wynik = {
    rodzaj: "rsi", szer: m.size?.x ?? 32, wys: m.size?.y ?? 32, stany: new Map(), kolejnosc: [],
    licencja: m.license || "", autorzy: m.copyright || "",
  };
  for (const s of m.states || []) {
    const kierunki = s.directions || 1;
    const opoznienia = (s.delays?.[0] || [1]).map((x) => Math.max(10, x * 1000));
    wynik.stany.set(s.name, {
      nazwa: s.name, kierunki, klatki: opoznienia.length, opoznienia, indeks: 0,
      obraz: null, kolumny: 1, url: urlPliku(repo, `${sciezka}/${s.name}.png`),
    });
    wynik.kolejnosc.push(s.name);
  }
  return wynik;
}

export function plik(repo, sciezka) {
  const klucz = repo + "|" + sciezka;
  let p = pliki.get(klucz);
  if (!p) {
    p = (sciezka.endsWith(".rsi") ? wczytajRsi(repo, sciezka) : wczytajDmi(repo, sciezka)).catch((e) => {
      console.warn("Nie wczytano", sciezka, e);
      return null;
    });
    pliki.set(klucz, p);
  }
  return p;
}

// Obrazek stanu: w .dmi jest od razu, w .rsi doczytywany przy pierwszym użyciu.
export async function stan(repo, sciezka, nazwa) {
  const p = await plik(repo, sciezka);
  if (!p) return null;
  const s = p.stany.get(nazwa) ?? (p.rodzaj === "dmi" ? p.stany.get("") : null);
  if (!s) return null;
  if (!s.obraz && s.url) {
    s._obietnica ??= pobierz(s.url).then((r) => r.blob()).then(createImageBitmap).then((obraz) => {
      s.obraz = obraz;
      s.kolumny = Math.max(1, Math.floor(obraz.width / p.szer));
    }).catch(() => null);
    await s._obietnica;
  }
  if (!s.obraz) return null;
  return { plik: p, s, szer: p.szer, wys: p.wys };
}

export function czasAnimacji(s) {
  const suma = s.opoznienia.reduce((a, b) => a + b, 0);
  return s.wstecz && s.klatki > 2 ? suma * 2 - s.opoznienia[0] - s.opoznienia[s.klatki - 1] : suma;
}

// Numer klatki animacji dla danej chwili (ms).
export function numerKlatki(s, czas) {
  if (s.klatki <= 1) return 0;
  const kolejnosc = [...Array(s.klatki).keys()];
  if (s.wstecz) for (let i = s.klatki - 2; i > 0; i--) kolejnosc.push(i);
  const suma = kolejnosc.reduce((a, k) => a + s.opoznienia[k], 0);
  let t = czas % suma;
  for (const k of kolejnosc) {
    t -= s.opoznienia[k];
    if (t < 0) return k;
  }
  return 0;
}

export function wycinek(st, kierunek, klatka) {
  const { s, szer, wys, plik: p } = st;
  let d = s.kierunki > 1 ? Math.min(kierunek, s.kierunki - 1) : 0;
  if (s.kierunki === 4 && kierunek > 3) d = 0;
  const n = p.rodzaj === "dmi" ? s.indeks + klatka * s.kierunki + d : d * s.klatki + klatka;
  return { obraz: s.obraz, sx: (n % s.kolumny) * szer, sy: Math.floor(n / s.kolumny) * wys, w: szer, h: wys };
}

const robocze = document.createElement("canvas");

// Rysuje warstwę (z ewentualnym kolorem SS14 – mnożenie) w punkcie (x, y) w skali.
export function rysuj(ctx, st, kierunek, klatka, x, y, skala, kolor) {
  const w = wycinek(st, kierunek, klatka);
  if (!kolor) {
    ctx.drawImage(w.obraz, w.sx, w.sy, w.w, w.h, x, y, w.w * skala, w.h * skala);
    return;
  }
  robocze.width = w.w; robocze.height = w.h;
  const c = robocze.getContext("2d");
  c.clearRect(0, 0, w.w, w.h);
  c.globalCompositeOperation = "source-over";
  c.drawImage(w.obraz, w.sx, w.sy, w.w, w.h, 0, 0, w.w, w.h);
  c.globalCompositeOperation = "multiply";
  c.fillStyle = kolor.length === 9 ? kolor.slice(0, 7) : kolor;
  c.fillRect(0, 0, w.w, w.h);
  c.globalCompositeOperation = "destination-in";
  c.drawImage(w.obraz, w.sx, w.sy, w.w, w.h, 0, 0, w.w, w.h);
  ctx.drawImage(robocze, 0, 0, w.w, w.h, x, y, w.w * skala, w.h * skala);
}
