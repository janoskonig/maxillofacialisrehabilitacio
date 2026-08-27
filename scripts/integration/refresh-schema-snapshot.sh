#!/usr/bin/env bash
# A fejlesztői DB sémájának pillanatképe az integrációs teszt-DB felépítéséhez.
#
# Mikor futtasd újra?
#  - ha a séma a tracked migrációkon KÍVÜL változik (legacy SQL, kézi ALTER);
#  - tracked migráció után NEM kell: azt a teszt global-setup magától alkalmazza
#    (a node_migrations pillanatkép-adata mondja meg, honnan folytassa).
#
# Kimenet (commitolandó, adatot nem tartalmaz):
#   database/integration/schema-snapshot.sql
#   database/integration/node-migrations-data.sql
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/database/integration"
mkdir -p "$OUT"

SRC_URL="${SNAPSHOT_SOURCE_URL:-}"
if [ -z "$SRC_URL" ]; then
  SRC_URL=$(node -e "const fs=require('fs');const m=fs.readFileSync('$ROOT/.env.local','utf8').match(/^DATABASE_URL=(.*)$/m);console.log(m[1])")
fi

pg_dump "$SRC_URL" --schema-only --no-owner --no-privileges > "$OUT/schema-snapshot.sql"
pg_dump "$SRC_URL" --data-only --no-owner --no-privileges -t node_migrations > "$OUT/node-migrations-data.sql"

SRC_DB=$(node -e "console.log(new URL('$SRC_URL').pathname.slice(1))")
echo "Pillanatkép frissítve: $OUT (forrás DB: $SRC_DB)"
