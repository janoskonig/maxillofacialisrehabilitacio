#!/usr/bin/env bash
# Bootstrap throwaway maxfac_sim schema. Fresh DB assumed.
set -u
export PGPASSWORD=REDACTED_LOCAL_DEV_PW
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
L="$ROOT/database/legacy"
run() { psql -h 127.0.0.1 -U maxfac -d maxfac_sim -v ON_ERROR_STOP=0 -q -f "$1" 2>&1; }
has_err() { echo "$1" | grep -qiE "^psql.*ERROR|^ERROR"; }

echo "### schema.sql"; out=$(psql -h 127.0.0.1 -U maxfac -d maxfac_sim -v ON_ERROR_STOP=0 -q -f "$ROOT/database/schema.sql" 2>&1); has_err "$out" && echo "$out" | grep -iE ERROR | head

# Base tables in dependency order
BASE=(migration_users.sql migration_users_add_name.sql migration_users_institution.sql
      migration_episode_stage_milestone.sql migration_time_slots.sql
      migration_scheduling_v2.sql migration_reason_treatment_type.sql)
echo "### base (ordered)"
for b in "${BASE[@]}"; do out=$(run "$L/$b"); has_err "$out" && { echo "  ERR $b:"; echo "$out"|grep -iE ERROR|grep -viE "already exists"|head -3|sed 's/^/    /'; }; done

# Exclusions: destructive + already-run base
EXCL="migration_rollback_available_time_slots.sql migration_recreate_table.sql ${BASE[*]}"
REMAIN=()
for f in $(ls "$L"/migration_*.sql | sort); do
  bn=$(basename "$f"); skip=0
  for e in $EXCL; do [ "$bn" = "$e" ] && skip=1; done
  [ "$skip" = "0" ] && REMAIN+=("$f")
done

echo "### remaining (${#REMAIN[@]} files), re-run only failures"
TODO=("${REMAIN[@]}")
for pass in 1 2 3; do
  NEXT=()
  for f in "${TODO[@]}"; do
    out=$(run "$f")
    # ignore pure "already exists" idempotency noise
    real=$(echo "$out" | grep -iE "ERROR" | grep -viE "already exists")
    if [ -n "$real" ]; then NEXT+=("$f"); [ "$pass" = "3" ] && { echo "  STILL FAIL $(basename "$f"):"; echo "$real"|head -2|sed 's/^/    /'; }; fi
  done
  echo "  pass $pass: $((${#TODO[@]})) tried, ${#NEXT[@]} still failing"
  [ ${#NEXT[@]} -eq 0 ] && break
  TODO=("${NEXT[@]}")
done
