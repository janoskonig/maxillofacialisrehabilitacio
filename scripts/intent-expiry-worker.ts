/**
 * Intent TTL expiry worker (run daily or every few hours via cron).
 * Usage: npx ts-node scripts/intent-expiry-worker.ts
 *
 * Cron example: 0 */6 * * * cd /path && npx ts-node scripts/intent-expiry-worker.ts
 */

import 'dotenv/config';
import { runIntentExpiry } from '../lib/intent-expiry';

runIntentExpiry()
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
