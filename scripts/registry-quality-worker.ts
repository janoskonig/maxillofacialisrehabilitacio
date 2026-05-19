/**
 * Registry quality recompute queue worker (idempotent batch drain).
 * Usage: npx tsx scripts/registry-quality-worker.ts
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const envLocalPath = path.join(__dirname, '..', '.env.local');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}
import { getDbPool } from '../lib/db';
import { getComplianceFeatureFlag } from '../lib/research-registry/feature-flags';
import { processQualityRecomputeBatch } from '../lib/research-registry/quality-queue';

async function main() {
  const enabled = await getComplianceFeatureFlag('quality_recompute_queue');
  if (!enabled) {
    console.log(
      JSON.stringify({
        skipped: true,
        reason: 'quality_recompute_queue disabled',
        processed: 0,
      })
    );
    process.exit(0);
  }

  const processed = await processQualityRecomputeBatch(getDbPool());
  console.log(JSON.stringify({ processed }));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
