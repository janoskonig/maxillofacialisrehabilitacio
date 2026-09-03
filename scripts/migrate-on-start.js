/**
 * Opt-in migráció induláskor (npm `prestart` hook).
 *
 * A Render deploy nem futtat migrációt: a kód a build után élesbe megy, a
 * tracked migrációk (database/migrations) viszont csak kézi `npm run migrate`
 * után élnek — így fordult elő, hogy a 094-es (episode_visits.appointment_id)
 * nélkül a terv-fül 42703-mal (undefined_column) 500-azott.
 *
 * Ha az `AUTO_MIGRATE_ON_START=true` env be van állítva, az indulás ELŐTT
 * lefuttatja a scripts/run-all-migrations.js-t (idempotens, node_migrations-
 * ben követett). Hibánál az indulás megszakad (nem indul félkész sémán a
 * szolgáltatás) — a log megmondja, melyik migráció bukott. Env nélkül csendes
 * no-op, a viselkedés változatlan.
 */
const { spawnSync } = require('child_process');
const path = require('path');

if (process.env.AUTO_MIGRATE_ON_START !== 'true') {
  process.exit(0);
}

console.log('[migrate-on-start] AUTO_MIGRATE_ON_START=true → tracked migrációk futtatása indulás előtt');
const result = spawnSync(process.execPath, [path.join(__dirname, 'run-all-migrations.js')], {
  stdio: 'inherit',
  env: process.env,
});
if (result.status !== 0) {
  console.error(
    `[migrate-on-start] Migráció sikertelen (exit ${result.status ?? 'signal'}) — az indulást megszakítjuk, hogy ne fusson félkész sémán a szolgáltatás.`
  );
  process.exit(result.status ?? 1);
}
console.log('[migrate-on-start] Migrációk rendben, indulás.');
