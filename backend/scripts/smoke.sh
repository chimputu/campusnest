#!/usr/bin/env bash
set -u

BASE="http://localhost:3000"
WORK="$(mktemp -d)"
RUN="$(date +%s)"

TENANT_EMAIL="smoke.tenant.${RUN}@example.com"
LANDLORD_EMAIL="smoke.landlord.${RUN}@example.com"
ADMIN_EMAIL="$(grep -E '^ADMIN_EMAIL=' .env | head -1 | cut -d= -f2-)"
ADMIN_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' .env | head -1 | cut -d= -f2-)"

TJAR="$WORK/tenant.jar"
LJAR="$WORK/landlord.jar"
AJAR="$WORK/admin.jar"
BODY="$WORK/body.json"

code() {
  local method="$1" path="$2" jar="$3" data="$4"
  local args=(-s -o "$BODY" -w '%{http_code}' -X "$method" "$BASE$path")
  if [ -n "$jar" ]; then args+=(-b "$jar" -c "$jar"); fi
  if [ -n "$data" ]; then args+=(-H 'Content-Type: application/json' -d "$data"); fi
  curl "${args[@]}"
}

report() { echo "$1: $2"; }

report "register tenant" "$(code POST /api/auth/register '' "{\"full_name\":\"Smoke Tenant\",\"email\":\"$TENANT_EMAIL\",\"password\":\"smokepass123\",\"phone\":\"+260977000001\",\"role\":\"TENANT\"}")"
report "register landlord" "$(code POST /api/auth/register '' "{\"full_name\":\"Smoke Landlord\",\"email\":\"$LANDLORD_EMAIL\",\"password\":\"smokepass123\",\"phone\":\"+260977000002\",\"role\":\"LANDLORD\"}")"
report "duplicate register" "$(code POST /api/auth/register '' "{\"full_name\":\"Smoke Tenant\",\"email\":\"$TENANT_EMAIL\",\"password\":\"smokepass123\",\"phone\":\"+260977000001\",\"role\":\"TENANT\"}")"
report "login tenant" "$(code POST /api/auth/login "$TJAR" "{\"email\":\"$TENANT_EMAIL\",\"password\":\"smokepass123\"}")"
report "login landlord" "$(code POST /api/auth/login "$LJAR" "{\"email\":\"$LANDLORD_EMAIL\",\"password\":\"smokepass123\"}")"
report "login admin" "$(code POST /api/auth/login "$AJAR" "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")"
report "me with cookie" "$(code GET /api/auth/me "$TJAR" '')"
report "me without cookie" "$(code GET /api/auth/me '' '')"
report "zones" "$(code GET /api/zones '' '')"
report "listings public" "$(code GET /api/listings '' '')"
report "listings create unauth" "$(code POST /api/listings '' '{"title":"x"}')"
report "admin stats as tenant" "$(code GET /api/admin/stats "$TJAR" '')"
report "admin stats as admin" "$(code GET /api/admin/stats "$AJAR" '')"

ZONE_ID="$(curl -s "$BASE/api/zones" | python3 -c 'import sys,json; print(json.load(sys.stdin)["MAIN"][0]["id"])')"
LISTING_JSON="{\"zone_id\":$ZONE_ID,\"campus\":\"MAIN\",\"title\":\"Smoke Test House\",\"street_landmark\":\"Main Gate\",\"occupancy\":\"SHARING\",\"gender_policy\":\"MIXED_SEPARATE_BLOCKS\",\"electricity\":\"INCLUDED_IN_RENT\",\"room_type\":\"SHARED_ABLUTION\",\"kitchen\":\"SHARED_KITCHEN\",\"security_level\":\"FENCE_ONLY\",\"total_beds\":1,\"rent_per_month_zmw\":500,\"deposit_zmw\":500,\"status\":\"ACTIVE\",\"photos\":[]}"

report "create listing as tenant" "$(code POST /api/listings "$TJAR" "$LISTING_JSON")"
CREATE_CODE="$(code POST /api/listings "$LJAR" "$LISTING_JSON")"
report "create listing as landlord" "$CREATE_CODE"
LISTING_ID="$(python3 -c 'import json; print(json.load(open("'"$BODY"'"))["listing"]["id"])')"

REQ_JSON="{\"listing_id\":$LISTING_ID,\"move_in_date\":\"2030-01-01\",\"duration_months\":6,\"note\":\"smoke\"}"
report "request as landlord (wrong role)" "$(code POST /api/requests "$LJAR" "$REQ_JSON")"
report "saved as landlord (wrong role)" "$(code GET /api/saved "$LJAR" '')"
report "request as tenant one" "$(code POST /api/requests "$TJAR" "$REQ_JSON")"
report "duplicate request" "$(code POST /api/requests "$TJAR" "$REQ_JSON")"

T2="smoke.tenant2.${RUN}@example.com"
code POST /api/auth/register '' "{\"full_name\":\"Smoke Tenant Two\",\"email\":\"$T2\",\"password\":\"smokepass123\",\"phone\":\"+260977000003\",\"role\":\"TENANT\"}" >/dev/null
T2JAR="$WORK/t2.jar"
code POST /api/auth/login "$T2JAR" "{\"email\":\"$T2\",\"password\":\"smokepass123\"}" >/dev/null
report "request as tenant two" "$(code POST /api/requests "$T2JAR" "$REQ_JSON")"

RID="$(curl -s -b "$TJAR" "$BASE/api/requests/mine" | python3 -c 'import sys,json; print(json.load(sys.stdin)["requests"][0]["id"])')"
RID2="$(curl -s -b "$T2JAR" "$BASE/api/requests/mine" | python3 -c 'import sys,json; print(json.load(sys.stdin)["requests"][0]["id"])')"

curl -s -o "$WORK/a1" -w '%{http_code}' -b "$LJAR" -X POST "$BASE/api/requests/$RID/accept" >"$WORK/c1" &
P1=$!
curl -s -o "$WORK/a2" -w '%{http_code}' -b "$LJAR" -X POST "$BASE/api/requests/$RID2/accept" >"$WORK/c2" &
P2=$!
wait "$P1"; wait "$P2"
report "parallel accept one" "$(cat "$WORK/c1")"
report "parallel accept two" "$(cat "$WORK/c2")"

report "listing status after accepts" "$(curl -s "$BASE/api/listings/$LISTING_ID" | python3 -c 'import sys,json; print(json.load(sys.stdin)["listing"]["status"])')"
if [ "$(cat "$WORK/c1")" = "200" ]; then WIN="$WORK/a1"; WIN_RID="$RID"; LOSE_RID="$RID2"; else WIN="$WORK/a2"; WIN_RID="$RID2"; LOSE_RID="$RID"; fi
CODE_ACCEPTED="$(python3 -c 'import json; print(json.load(open("'"$WIN"'"))["request"]["reference_code"])')"
report "receipt public" "$(code GET "/api/receipts/$CODE_ACCEPTED" '' '')"
report "receipt unknown code" "$(code GET /api/receipts/CN-0000-0000-AAAAAA '' '')"
report "receipt no PII" "$(python3 -c 'import json; d=json.load(open("'"$BODY"'")); print("clean" if not any(k in d for k in ("phone","email","student_id","registration_number")) else "LEAK")')"

if [ "$(cat "$WORK/c1")" = "200" ]; then WIN_JAR="$TJAR"; else WIN_JAR="$T2JAR"; fi
report "cancel accepted" "$(code POST "/api/requests/$WIN_RID/cancel" "$WIN_JAR" '')"
report "receipt after cancel" "$(code GET "/api/receipts/$CODE_ACCEPTED" '' '')"
report "listing status after cancel" "$(curl -s "$BASE/api/listings/$LISTING_ID" | python3 -c 'import sys,json; print(json.load(sys.stdin)["listing"]["status"])')"

report "re-accept other request" "$(code POST "/api/requests/$LOSE_RID/accept" "$LJAR" '')"
report "complete accepted" "$(code POST "/api/requests/$LOSE_RID/complete" "$LJAR" '')"
report "listing status after complete" "$(curl -s "$BASE/api/listings/$LISTING_ID" | python3 -c 'import sys,json; print(json.load(sys.stdin)["listing"]["status"])')"

report "hide listing" "$(code POST "/api/admin/listings/$LISTING_ID/hide" "$AJAR" '')"
report "patch removed listing" "$(code PATCH "/api/listings/$LISTING_ID" "$LJAR" '{"title":"Changed"}')"

TENANT_ID="$(curl -s -b "$TJAR" "$BASE/api/auth/me" | python3 -c 'import sys,json; print(json.load(sys.stdin)["user"]["id"])')"
report "suspend tenant" "$(code POST "/api/admin/users/$TENANT_ID/suspend" "$AJAR" '{"reason":"smoke"}')"
report "me while suspended" "$(code GET /api/auth/me "$TJAR" '')"
report "reactivate tenant" "$(code POST "/api/admin/users/$TENANT_ID/reactivate" "$AJAR" '')"
report "static backend/server.js" "$(code GET /backend/server.js '' '')"
report "static package.json" "$(code GET /package.json '' '')"
report "static .env" "$(code GET /.env '' '')"
report "logout" "$(code POST /api/auth/logout "$TJAR" '')"
rm -rf "$WORK"
