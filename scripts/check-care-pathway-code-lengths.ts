/**
 * Guard against the step_code-overflow bug class (migration 058):
 * every care_pathway work_phase_code must fit the step-code columns (VARCHAR(80)),
 * otherwise projectRemainingSteps / appointment booking throws "value too long".
 *
 * Run in CI or after editing pathways: npx tsx scripts/check-care-pathway-code-lengths.ts
 * Exits non-zero (and lists offenders) if any code exceeds the limit.
 */
import 'dotenv/config';
import { getDbPool } from '../lib/db';

const MAX = 80;

async function main() {
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT cp.name, p->>'work_phase_code' AS code, length(p->>'work_phase_code') AS len
       FROM care_pathways cp
       LEFT JOIN LATERAL jsonb_array_elements(cp.work_phases_json) p ON true
      WHERE length(p->>'work_phase_code') > $1
      ORDER BY len DESC`,
    [MAX],
  );
  if (res.rows.length === 0) {
    console.log(`✓ All care_pathway work_phase_codes fit VARCHAR(${MAX}).`);
    await pool.end();
    process.exit(0);
  }
  console.error(`✗ ${res.rows.length} care_pathway work_phase_code(s) exceed ${MAX} chars:`);
  for (const r of res.rows) {
    console.error(`  - "${r.code}" (${r.len}) in pathway "${r.name}"`);
  }
  await pool.end();
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
