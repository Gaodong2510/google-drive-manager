#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-http://127.0.0.1:8787}"
echo "Testing $BASE"
curl -fsS "$BASE/api/health" >/dev/null
TOKEN=$(curl -fsS -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
AUTH="Authorization: Bearer $TOKEN"
curl -fsS "$BASE/api/dashboard" -H "$AUTH" >/dev/null
curl -fsS "$BASE/api/rclone/status" -H "$AUTH" >/dev/null
curl -fsS "$BASE/api/accounts" -H "$AUTH" >/dev/null
curl -fsS "$BASE/api/mounts" -H "$AUTH" >/dev/null
curl -fsS "$BASE/api/cache" -H "$AUTH" >/dev/null
curl -fsS "$BASE/" -o /dev/null
echo "OK: health, login, dashboard, rclone, accounts, mounts, cache, frontend"
