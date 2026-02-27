/**
 * Run capacity pool rebalance (CLI).
 * Usage: npx ts-node scripts/rebalance-capacity-pools.ts
 */

import 'dotenv/config';
import { runRebalance } from '../lib/rebalance-capacity-pools';

runRebalance()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.errors.length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
