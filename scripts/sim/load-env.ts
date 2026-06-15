// Side-effect module: load .env.local BEFORE any other import evaluates.
// ESM evaluates imports depth-first in source order, and lib/auth-server.ts
// captures process.env.JWT_SECRET at module-eval time. If dotenv ran only as a
// statement (after the import graph resolved), auth-server would already have
// frozen the fallback secret, and minted test tokens would fail verification.
// Importing this first guarantees the env is populated before that capture.
import { config } from 'dotenv';
config({ path: '.env.local' });
