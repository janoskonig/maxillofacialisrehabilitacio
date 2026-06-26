// Side-effect module: load env for the SIM harness BEFORE any lib import evaluates.
//
//   1. `.env.local` first  → gives JWT_SECRET (route handlers' lib/auth-server.ts
//      captures it at module-eval time) and the (production) DATABASE_URL.
//   2. `.env.sim` with override → gives SIM_DATABASE_URL pointing at the throwaway
//      `maxfac_sim` database.
//   3. We then FORCE `DATABASE_URL = SIM_DATABASE_URL` so lib/db.ts getDbPool()
//      connects to the throwaway DB and never to production.
//
// Import this FIRST (before ./assert-sim-db and before any '../../lib/*' import).
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env.sim', override: true });

if (process.env.SIM_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.SIM_DATABASE_URL;
}
