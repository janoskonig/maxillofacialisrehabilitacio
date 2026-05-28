import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

const buildIdPath = join(process.cwd(), '.next', 'BUILD_ID');

try {
  await access(buildIdPath, constants.R_OK);
} catch {
  console.error(
    [
      'Production start aborted: .next/BUILD_ID is missing.',
      'Run `npm run build` before `npm start`, or deploy via the Dockerfile so the build step completes.',
    ].join('\n')
  );
  process.exit(1);
}
