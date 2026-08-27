#!/usr/bin/env bash
# Eldobható integrációs teszt-DB felépítése séma-pillanatképből.
#
# Lépések: DROP/CREATE a teszt-DB-n → database/integration/schema-snapshot.sql
# visszatöltése → node_migrations pillanatkép-adat → az azóta született tracked
# migrációk alkalmazása (scripts/run-all-migrations.js) → matview-k feltöltése.
#
# Használat (lásd docs/INTEGRATION_TESTS.md):
#   PGPASSWORD='<maxfac jelszó>' npm run test:integration:setup
#
# Env:
#   PGPASSWORD  kötelező — a maxfac DB-szerepkör jelszava (nincs commitolva!)
#   TEST_DB     a teszt-DB neve, alapból maxfac_test; _test végződés kötelező
#   PGHOST_TCP  a Postgres host (alapból 127.0.0.1)
#   ADMIN_PSQL  a DROP/CREATE-hez használt psql, ha a maxfac usernek nincs
#               CREATEDB joga (pl. 'psql -h /tmp' helyi superuserrel)
set -euo pipefail

export PGPASSWORD="${PGPASSWORD:?Állítsd be a PGPASSWORD-öt (maxfac DB jelszó) — lásd docs/INTEGRATION_TESTS.md}"
DB="${TEST_DB:-maxfac_test}"
case "$DB" in
  *_test) ;;
  *) echo "HIBA: a teszt-DB nevének _test-re kell végződnie (kapott: $DB)" >&2; exit 1 ;;
esac

PSQL="${PSQL:-psql}"
HOST="${PGHOST_TCP:-127.0.0.1}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SNAP="$ROOT/database/integration/schema-snapshot.sql"
MIGDATA="$ROOT/database/integration/node-migrations-data.sql"

if [ ! -f "$SNAP" ]; then
  echo "HIBA: hiányzik a séma-pillanatkép ($SNAP)." >&2
  echo "Generáld: bash scripts/integration/refresh-schema-snapshot.sh" >&2
  exit 1
fi

ADMIN_PSQL="${ADMIN_PSQL:-$PSQL -h $HOST -U maxfac}"
if ! $ADMIN_PSQL -d postgres -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null 2>&1; then
  # fallback: helyi superuser socketen (tipikus fejlesztői gép)
  ADMIN_PSQL="$PSQL -h /tmp"
fi

echo "### DROP/CREATE $DB"
$ADMIN_PSQL -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB"
$ADMIN_PSQL -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB OWNER maxfac"

# Extension-ök adminként (a maxfac usernek ehhez nem biztos, hogy van joga).
{ grep -ihE '^CREATE EXTENSION' "$SNAP" || true; } | while IFS= read -r stmt; do
  $ADMIN_PSQL -d "$DB" -v ON_ERROR_STOP=1 -c "$stmt"
done

echo "### séma-pillanatkép visszatöltése"
$PSQL -h "$HOST" -U maxfac -d "$DB" -v ON_ERROR_STOP=1 -q -f "$SNAP"

echo "### node_migrations pillanatkép-adat"
$PSQL -h "$HOST" -U maxfac -d "$DB" -v ON_ERROR_STOP=1 -q -f "$MIGDATA"

echo "### az azóta született tracked migrációk"
DATABASE_URL="postgresql://maxfac:${PGPASSWORD}@${HOST}:5432/${DB}?sslmode=disable" \
  node "$ROOT/scripts/run-all-migrations.js"

echo "### materialized view-k feltöltése"
$PSQL -h "$HOST" -U maxfac -d "$DB" -At -c \
  "SELECT format('REFRESH MATERIALIZED VIEW %I.%I;', schemaname, matviewname) FROM pg_matviews" \
  | $PSQL -h "$HOST" -U maxfac -d "$DB" -v ON_ERROR_STOP=0 -q

echo "### kész: $DB"
