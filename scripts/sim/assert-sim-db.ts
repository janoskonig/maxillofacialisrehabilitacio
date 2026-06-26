// Side-effect HARD GUARD: refuse to run destructive sim scripts against anything
// other than the throwaway `maxfac_sim` database.
//
// The harness's first act is a `TRUNCATE ... RESTART IDENTITY CASCADE`. If the
// active DATABASE_URL ever points at the real `maxillofacial_rehab` (which is
// what `.env.local` contains by default), that TRUNCATE would wipe production.
// This module exits the process before any such damage can occur.
//
// Import this RIGHT AFTER ./load-sim-env and BEFORE any code that touches the DB.

const url = process.env.DATABASE_URL ?? '';
const dbName = (() => {
  try {
    // pathname is "/<dbname>"; strip query string if present
    return new URL(url).pathname.replace(/^\//, '').split('?')[0];
  } catch {
    return '';
  }
})();

// Allowlist: only databases whose name is a throwaway sim DB.
const ALLOW = /(^|_)sim($|_)|^maxfac_sim$|^pr\d+_sim$/;

if (!dbName || !ALLOW.test(dbName)) {
  // eslint-disable-next-line no-console
  console.error(
    `\n🛑 SIM GUARD: refusing to run.\n` +
      `   Active DATABASE_URL database is "${dbName || '(unparseable)'}".\n` +
      `   Destructive sim scripts may ONLY target a throwaway sim DB (e.g. "maxfac_sim").\n` +
      `   Set SIM_DATABASE_URL in .env.sim and run via the sim:* npm scripts.\n`
  );
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log(`✅ SIM GUARD: target DB "${dbName}" is a throwaway sim DB — proceeding.`);

// Modullá tesszük (a dinamikus `await import('./assert-sim-db')` miatt) — nincs
// futásidejű hatása.
export {};
