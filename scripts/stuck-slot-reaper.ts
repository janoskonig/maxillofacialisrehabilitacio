/**
 * Stuck-slot reaper worker (run every 5–10 min via cron).
 * Usage: npx tsx scripts/stuck-slot-reaper.ts
 *
 * Frees FUTURE slots stuck in state 'held'/'offered' with no live hold, so they
 * can be booked again. See lib/stuck-slot-reaper.ts.
 */
import 'dotenv/config';
import { runStuckSlotReaper } from '../lib/stuck-slot-reaper';

runStuckSlotReaper()
  .then((r) => {
    if (r.freed > 0) {
      console.log(JSON.stringify({ freed: r.freed, slotIds: r.slotIds }, null, 2));
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
