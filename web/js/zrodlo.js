// Skąd strona bierze dane: lokalny serwer (serwer.py) albo wersja online na GitHub Pages.
//
// Online nie ma serwera: CI zapisuje indeksy w dane/*.json, a sprite'y i dźwięki strona
// pobiera z raw.githubusercontent.com z tego samego commita, z którego CI zbudowało indeks.
// Ręczne poprawki zapisują się wtedy w przeglądarce (localStorage) i można je wyeksportować.

export const zrodlo = { statyczny: false, info: null };

const POPRAWKI = "portal:reczne:v1";

export async function wykryj() {
  try {
    const r = await fetch("dane/strona.json", { cache: "no-store" });
    const j = r.ok ? await r.json() : null;
    if (j && Array.isArray(j.repa)) {   // lokalny serwer odpowiada {"tryb": "lokalny"}
      zrodlo.info = j;
      zrodlo.statyczny = true;
    }
  } catch { /* lokalny serwer */ }
}

const koduj = (sciezka) => sciezka.split("/").map(encodeURIComponent).join("/");

export function urlPliku(repoId, sciezka) {
  if (!zrodlo.statyczny) return `/plik/${repoId}/${koduj(sciezka)}`;
  const r = zrodlo.info.repa.find((x) => x.id === repoId);
  return `https://raw.githubusercontent.com/${r.github.replace("https://github.com/", "")}/${r.sha}/${koduj(sciezka)}`;
}

function poprawkiLokalne() {
  try { return JSON.parse(localStorage.getItem(POPRAWKI)) || null; } catch { return null; }
}

export async function pobierz(api) {
  if (!zrodlo.statyczny) {
    const r = await fetch(api);
    if (!r.ok) throw new Error(`${r.status} ${api}`);
    return r.json();
  }
  if (api === "/api/repo") return zrodlo.info.repa.map((r) => ({ ...r, sciezka: r.github, github_sha: r.sha, stan: { etap: "gotowe", blad: null } }));
  if (api === "/api/propozycje") return [];
  if (api === "/api/sciezki") return (await fetch("dane/sciezki.json")).json();
  if (api === "/api/reczne") {
    const wspolne = await fetch("dane/reczne.json").then((r) => (r.ok ? r.json() : { pary: {} })).catch(() => ({ pary: {} }));
    const lokalne = poprawkiLokalne();
    return lokalne ? { pary: { ...wspolne.pary, ...lokalne.pary } } : wspolne;
  }
  const m = api.match(/^\/api\/(indeks|dzwieki)\/(\w+)$/);
  if (m) {
    const r = await fetch(`dane/${m[1]}-${m[2]}.json`);
    if (!r.ok) throw new Error(`${r.status} ${api}`);
    return r.json();
  }
  throw new Error("Wersja online nie obsługuje: " + api);
}

export async function wyslij(api, dane) {
  if (!zrodlo.statyczny) {
    const r = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dane) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.blad || r.statusText);
    return j;
  }
  if (api === "/api/reczne") {
    try { localStorage.setItem(POPRAWKI, JSON.stringify(dane)); } catch { /* prywatne okno */ }
    return { ok: true };
  }
  throw new Error("W wersji online nie da się tego zrobić. Uruchom Portal lokalnie (uruchom.bat).");
}

// Pobranie poprawek jako plik reczne.json (do wrzucenia do repo Portalu).
export function eksportujPoprawki(dane) {
  const blob = new Blob([JSON.stringify(dane, null, 1) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "reczne.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
