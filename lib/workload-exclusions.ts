/**
 * Az „Orvos terhelés" widgetből és az intake recommendation számolásából
 * kihagyott orvosok – részleges név (case-insensitive ILIKE %minta%) alapján.
 *
 * Egyetlen forrás: ha új orvost kell kiszedni / visszavenni, csak ezt a listát
 * kell módosítani, és minden hivatkozó endpoint automatikusan követi.
 */
export const WORKLOAD_EXCLUDED_NAME_PATTERNS = [
  'Déri',
  'Hermann',
  'Kádár',
  'Kivovics',
  'Pótlár',
  'Jász',
  'Pál Adrienn',
  'Vánkos',
] as const;

/**
 * SQL `WHERE` fragmens, ami kizárja a fenti mintáknak megfelelő `doktor_neve`
 * értékeket. A paraméter-indexek a megadott `startIndex`-től számítva
 * folytonosak (pl. ha a hívó már lefoglalta `$1`-et, `startIndex = 2`).
 *
 * Visszaadja a `clause`-t (pl. `doktor_neve NOT ILIKE $2 AND doktor_neve NOT ILIKE $3 ...`)
 * és a hozzá tartozó paraméterek tömbjét (`['%Déri%', '%Hermann%', ...]`).
 */
export function buildWorkloadExclusionClause(startIndex = 1): {
  clause: string;
  params: string[];
} {
  const clause = WORKLOAD_EXCLUDED_NAME_PATTERNS.map(
    (_, i) => `doktor_neve NOT ILIKE $${startIndex + i}`
  ).join(' AND ');
  const params = WORKLOAD_EXCLUDED_NAME_PATTERNS.map((n) => `%${n}%`);
  return { clause, params };
}
