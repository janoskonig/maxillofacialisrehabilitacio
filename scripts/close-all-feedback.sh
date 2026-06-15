#!/usr/bin/env bash
# Lezárja MIND a 21 nyitott feedback ticketet a produkción (status: closed).
# Hitelesítés egyik módja:
#   A) export ADMIN_EMAIL=... ADMIN_PASSWORD=...   majd a script bejelentkezik
#   B) export AUTH_TOKEN=<bearer-token>             (kihagyja a logint)
set -euo pipefail

BASE="https://rehabilitacios-protetika.hu"

if [[ -z "${AUTH_TOKEN:-}" ]]; then
  if [[ -z "${ADMIN_EMAIL:-}" || -z "${ADMIN_PASSWORD:-}" ]]; then
    echo "Adj meg ADMIN_EMAIL + ADMIN_PASSWORD vagy AUTH_TOKEN env-et." >&2
    exit 1
  fi
  echo "Bejelentkezés ${ADMIN_EMAIL}..." >&2
  AUTH_TOKEN=$(curl -s -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
    | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  if [[ -z "$AUTH_TOKEN" ]]; then
    echo "Login sikertelen — nincs token a válaszban." >&2
    exit 1
  fi
fi

IDS=(
  bebb4226-b3a5-40a0-bc90-677366e0c6e2
  948f236b-59dd-4335-9723-44b90214321a
  94367c82-f32f-4a68-9473-b380d027b59e
  1884ef66-43da-4c14-b80c-b5abc51c66ae
  f1fc68d8-6b2f-430a-a27a-728e78012885
  1241720f-1e32-40ce-874d-450db2ffbf45
  36cfa283-fe7c-4c37-b6fc-c01ac6db1bff
  b0693e79-4a11-4ec2-a4e3-78fa0da051ae
  5079707c-67db-49bc-a471-4d705ddb5bc4
  ff7f7e99-7b2b-4043-8899-4aaf02ef477f
  7d77945b-e030-40e4-b5b0-cec217477737
  2394198b-2206-4d4a-a0e6-81e2701d29ac
  b7cc5a47-4b0e-4dd5-9f4e-cd023fa39d20
  f70ee607-75e1-45ce-9a14-a44732e78f58
  0f171767-cbd2-4fe1-845d-747532a1e81a
  8e7fd6d0-2dec-4b9d-ad8e-1f50baf6b457
  5e6f76ad-07a8-4a00-8284-44abb0270e54
  14a613a8-ae35-4c04-8b3c-b69db3596095
  65afb990-00bd-4c61-9839-68ff15113a1e
  bf3bb446-1921-4945-818d-a9c02b303b00
  e23502e3-64de-4c4e-b308-520c5cdb0dd8
)

ok=0; fail=0
for id in "${IDS[@]}"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/feedback/$id" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"status":"closed"}')
  if [[ "$code" == "200" ]]; then
    echo "OK   $id"; ok=$((ok+1))
  else
    echo "FAIL $id (HTTP $code)"; fail=$((fail+1))
  fi
done
echo "----"
echo "Lezárva: $ok / ${#IDS[@]}  (hiba: $fail)"
