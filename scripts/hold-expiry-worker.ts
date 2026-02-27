/**
 * Hold expiry worker (run every 5–10 min via cron).
 * Usage: npx ts-node scripts/hold-expiry-worker.ts
 *
 * Cron example (every 5 min): 0,5,10,15,20,25,30,35,40,45,50,55 * * * * cd /path && npx ts-node scripts/hold-expiry-worker.ts
 */

import 'dotenv/config';
import { runHoldExpiry } from '../lib/hold-expiry';

runHoldExpiry()
  .then((r) => {
    if (r.expired > 0 || r.errors.length > 0) {
      console.log(JSON.stringify({ expired: r.expired, errors: r.errors }, null, 2));
    }
    process.exit(r.errors.length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
