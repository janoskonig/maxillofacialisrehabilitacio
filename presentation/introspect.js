// READ-ONLY schema introspection
const fs = require("fs");
const path = require("path");
// load DATABASE_URL from .env.local
const envText = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
const m = envText.match(/^DATABASE_URL=(.*)$/m);
const url = m[1].trim().replace(/^['"]|['"]$/g, "");
const { Pool } = require("pg");
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });

const TABLES = [
  "patients", "patient_episodes", "ohip14_responses", "appointments",
  "consilium_sessions", "consilium_session_items", "care_pathways",
  "episode_work_phases", "documents", "patient_consent_events",
];

(async () => {
  try {
    const t = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
    console.log("=== ALL TABLES (" + t.rowCount + ") ===");
    console.log(t.rows.map(r => r.table_name).join(", "));
    for (const tbl of TABLES) {
      const c = await pool.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [tbl]);
      if (c.rowCount === 0) { console.log(`\n--- ${tbl}: NOT FOUND ---`); continue; }
      console.log(`\n--- ${tbl} ---`);
      console.log(c.rows.map(r => `${r.column_name}:${r.data_type}`).join(", "));
    }
  } catch (e) {
    console.error("ERR", e.message);
  } finally {
    await pool.end();
  }
})();
