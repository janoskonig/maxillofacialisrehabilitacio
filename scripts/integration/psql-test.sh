#!/usr/bin/env bash
# Segéd: psql a teszt-DB-n maxfac userrel, a .env.local jelszavával.
# Használat: bash scripts/integration/psql-test.sh -f file.sql | -c "SQL"
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PGPASSWORD=$(node -e "const fs=require('fs');const m=fs.readFileSync('$ROOT/.env.local','utf8').match(/^DATABASE_URL=(.*)$/m);console.log(new URL(m[1]).password)")
DB="${TEST_DB:-maxfac_test}"
exec psql -h 127.0.0.1 -U maxfac -d "$DB" -v ON_ERROR_STOP=0 -q "$@"
