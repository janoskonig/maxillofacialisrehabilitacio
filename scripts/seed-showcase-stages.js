/**
 * Seeds a stage progression (stage_events) for the demo episodes so the
 * patient pipeline, Stádium GANTT and waiting-times views are populated.
 * Operates on existing episodes — does not touch patient IDs.
 *
 *   node scripts/seed-showcase-stages.js
 */
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Pipeline shows STAGE_0..STAGE_4; STAGE_5/6 are later (protetikai/átadás).
const STAGES = ['STAGE_0', 'STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4', 'STAGE_5'];

async function main() {
  const eps = await pool.query(`
    SELECT e.id, e.patient_id, e.opened_at, p.nev
    FROM patient_episodes e JOIN patients p ON p.id = e.patient_id
    WHERE p.created_by = 'admin@demo.hu'
    ORDER BY e.opened_at`);

  // Clear any prior demo stage events for these episodes.
  const epIds = eps.rows.map((r) => r.id);
  if (epIds.length) {
    await pool.query(`DELETE FROM stage_events WHERE episode_id = ANY($1::uuid[])`, [epIds]);
  }

  let i = 0, evCount = 0;
  for (const ep of eps.rows) {
    // Distribute patients across the stages; cap so some sit in each column.
    const target = i % STAGES.length;
    const opened = ep.opened_at ? new Date(ep.opened_at) : new Date(Date.now() - 40 * 864e5);
    for (let s = 0; s <= target; s++) {
      const at = new Date(opened.getTime() + s * 6 * 864e5); // ~6 days per stage
      await pool.query(
        `INSERT INTO stage_events (patient_id, episode_id, stage_code, at, note, created_by)
         VALUES ($1,$2,$3,$4,$5,'admin@demo.hu')`,
        [ep.patient_id, ep.id, STAGES[s], at, s === target ? 'Aktuális stádium' : null]
      );
      evCount++;
    }
    i++;
  }
  console.log(`stage_events seeded: ${evCount} across ${eps.rows.length} episodes`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
