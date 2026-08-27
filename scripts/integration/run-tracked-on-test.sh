#!/usr/bin/env bash
# Segéd: tracked migrációk futtatása a teszt-DB-n a .env.local jelszavával.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PW=$(node -e "const fs=require('fs');const m=fs.readFileSync('$ROOT/.env.local','utf8').match(/^DATABASE_URL=(.*)$/m);console.log(new URL(m[1]).password)")
DB="${TEST_DB:-maxfac_test}"
DATABASE_URL="postgresql://maxfac:${PW}@127.0.0.1:5432/${DB}?sslmode=disable" node "$ROOT/scripts/run-all-migrations.js" "$@"
