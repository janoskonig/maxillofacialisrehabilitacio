/**
 * Személynév-normalizálás — EGYETLEN szabály az egész kódbázisra.
 *
 * A repó konvenciója, hogy névből azonosítót sosem tippelünk: csak akkor kötünk
 * össze két rekordot, ha a normalizált név PONTOSAN EGY jelöltre illeszkedik.
 * A normalizálás viszont eddig három különböző alakban élt (kisbetű+trim, illetve
 * NFD + ékezet-strip), így ugyanaz a név a különböző utakon máshogy viselkedett.
 * (2026-08-15)
 *
 * Szándékosan függőségmentes, hogy szerver- és kliensoldalon egyaránt használható
 * legyen. A DB-oldali párját (078 migráció `IMMUTABLE` SQL-függvénye) ugyanez a
 * szabály adja — a kettő egyezését teszt őrzi.
 */

/**
 * Kisbetűsít és eltávolítja az ékezeteket (NFD + combining mark strip).
 * **Nem trimmel** — tokenekre és részszövegekre is használható.
 */
export function foldAccents(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Teljes személynév normalizálása egyezés-vizsgálathoz: trim + kisbetű +
 * ékezet-strip. `null`/`undefined` → üres string (a hívó ezt „nincs név"-ként kezeli).
 */
export function normalizePersonName(value: string | null | undefined): string {
  return foldAccents((value ?? '').trim());
}

/**
 * Egyértelmű névfeloldás jelöltlistából: pontosan egy találatnál adja vissza a
 * jelöltet, nulla vagy több találatnál `null`-t. **Nem tippel** — a determinisztikus
 * tie-break (pl. `ORDER BY … LIMIT 1`) itt nem elfogadható, mert az csendben rossz
 * személyt választhat.
 *
 * A szűrés azért történik JS-ben és nem SQL-ben, mert normalizált paramétert nyers
 * oszlophoz hasonlítani nem lehet, egy SQL-oldali `LIMIT 2` pedig a normalizálás
 * *előtt* szűrne — így nem bizonyítana egyértelműséget.
 */
export function resolveUniqueByName<T>(
  name: string | null | undefined,
  candidates: T[],
  nameOf: (candidate: T) => string | null | undefined
): T | null {
  const target = normalizePersonName(name);
  if (target === '') return null;
  const matches = candidates.filter((c) => normalizePersonName(nameOf(c)) === target);
  return matches.length === 1 ? matches[0] : null;
}
