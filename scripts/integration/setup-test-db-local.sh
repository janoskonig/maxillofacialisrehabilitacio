#!/usr/bin/env bash
# Helyi kényelmi wrapper: a PGPASSWORD-öt a .env.local DATABASE_URL-jéből veszi,
# majd meghívja a setup-test-db.sh-t. CI-ben NE ezt használd (ott explicit env van).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGPASSWORD=$(node -e "const fs=require('fs');const m=fs.readFileSync('$ROOT/.env.local','utf8').match(/^DATABASE_URL=(.*)$/m);console.log(new URL(m[1]).password)") \
  exec bash "$ROOT/scripts/integration/setup-test-db.sh" "$@"
