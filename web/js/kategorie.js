// Kategorie i podgrupy do przeglądania (jak w edytorze map), wspólne dla SS13 i SS14.
//
// Sprite: kategoria z najdłuższego pasującego przedrostka (ścieżka typu SS13 albo folder
// prototypu SS14 w Entities/), podgrupa to kolejny człon. Dźwięk: kategoria z pierwszego
// folderu po sound/ albo Resources/Audio/, podgrupa to drugi folder.

export let kategorieSprite = [];
export let kategorieDzwiekow = [];
const reguly13 = new Map();
const reguly14 = new Map();
const folderyDzwiekow = new Map();

export async function wczytajKategorie() {
  const k = await fetch("kategorie.json").then((r) => r.json());
  kategorieSprite = k.sprite;
  for (const kat of kategorieSprite) {
    for (const p of kat.ss13) if (!reguly13.has(p)) reguly13.set(p, kat.id);
    for (const p of kat.ss14) if (!reguly14.has(p.toLowerCase())) reguly14.set(p.toLowerCase(), kat.id);
  }
  kategorieDzwiekow = k.dzwieki.kategorie;
  for (const kat of kategorieDzwiekow) for (const f of kat.foldery) folderyDzwiekow.set(f, kat.id);
}

const ladnie = (s) => s.replace(/\.ya?ml$/, "").replace(/[_-]+/g, " ");

// Ustawia p.kat i p.pod przedmiotu.
export function przypiszSprite(p) {
  let sciezka, reguly;
  if (p.id.startsWith("/")) { sciezka = p.id; reguly = reguly13; }
  else {
    const f = (p.f || "").toLowerCase();
    const i = f.indexOf("entities/");
    sciezka = (i >= 0 ? f.slice(i + 9) : f).replace(/\.ya?ml$/, "");
    reguly = reguly14;
  }
  // od najdłuższego przodka do najkrótszego
  let koniec = sciezka.length;
  while (koniec >= 0) {
    const przodek = sciezka.slice(0, koniec);
    const kat = reguly.get(przodek);
    if (kat) {
      p.kat = kat;
      const reszta = sciezka.slice(koniec).replace(/^\//, "");
      p.pod = reszta ? ladnie(reszta.split("/")[0]) : "ogólne";
      return;
    }
    if (koniec === 0) break;
    koniec = sciezka.lastIndexOf("/", koniec - 1);
    if (koniec < 0) koniec = 0;
  }
  p.kat = "inne";
  p.pod = ladnie(sciezka.split("/").filter(Boolean)[0] || "ogólne");
}

// Ustawia s._kat i s._pod dźwięku (s.p to ścieżka pliku w repo).
export function przypiszDzwiek(s) {
  let r = s.p.toLowerCase();
  const i = r.indexOf("resources/audio/");
  if (i >= 0) r = r.slice(i + 16);
  else {
    const j = r.lastIndexOf("sound/");
    if (j >= 0) r = r.slice(j + 6);
  }
  const czlony = r.split("/");
  czlony.pop();
  // foldery modularne SS14 (_Polonium, _Goobstation…) pomijamy
  while (czlony.length && czlony[0].startsWith("_")) czlony.shift();
  const dwa = czlony.slice(0, 2).join("/");
  s._kat = folderyDzwiekow.get(dwa) || folderyDzwiekow.get(czlony[0]) || "inne";
  s._pod = ladnie(czlony[1] || "ogólne");
}
