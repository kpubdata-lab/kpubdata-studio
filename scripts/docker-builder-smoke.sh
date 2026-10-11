#!/usr/bin/env bash
# Studio image against a Builder image (#904): start both the way a deployment would and
# check, from outside, every step a browser takes before Studio talks to Builder.
#
#   1. Studio's /config.js names the Builder URL it was given, with the real Builder on.
#   2. Studio's Content-Security-Policy lets the page connect to that Builder origin.
#   3. Builder answers /healthz.
#   4. Builder answers the browser's preflight from Studio's origin with that origin,
#      and the X-API-Key header among the ones it allows.
#   5. An authenticated request from Studio's origin is answered and readable by it.
#   6. An origin Builder was not told about gets no Access-Control-Allow-Origin, so the
#      checks above are not passing because Builder allows everyone.
#
# Usage:
#   STUDIO_IMAGE=kpubdata-studio:smoke BUILDER_IMAGE=kpubdata-builder:smoke \
#     bash scripts/docker-builder-smoke.sh
#
# Runs in CI (image.yml): on a pull request against images built there, and after a
# release against the published Studio image. Requires a Docker daemon. Exits nonzero
# when any check fails.
set -eu

: "${STUDIO_IMAGE:?set STUDIO_IMAGE to the Studio image to start}"
: "${BUILDER_IMAGE:?set BUILDER_IMAGE to the Builder image to start}"

STUDIO_PORT=18090
BUILDER_PORT=18091
STUDIO_ORIGIN="http://localhost:${STUDIO_PORT}"
BUILDER_URL="http://localhost:${BUILDER_PORT}"
# Not a secret: a value long enough for Builder's start-up check, used only here.
API_KEY="studio-smoke-$(date +%s)-0123456789abcdefghijklmnop"
PASS=0
FAIL=0

say()  { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS + 1)); say "  ok: $*"; }
bad()  { FAIL=$((FAIL + 1)); say "  FAIL: $*" >&2; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected [$3], got [$2])"; fi; }
header(){ printf '%s\n' "$1" | grep -i "^$2:" | head -n 1 | cut -d: -f2- | sed 's/^ *//' | tr -d '\r'; }

cleanup() {
  if [ "$FAIL" -ne 0 ]; then
    say "--- builder log ---"; docker logs smoke-builder 2>&1 | tail -n 40 || true
    say "--- studio log ---"; docker logs smoke-studio 2>&1 | tail -n 40 || true
  fi
  docker rm -f smoke-builder smoke-studio >/dev/null 2>&1 || true
}
trap cleanup EXIT

say "Studio:  ${STUDIO_IMAGE}"
say "Builder: ${BUILDER_IMAGE}"

docker run -d --name smoke-builder -p "127.0.0.1:${BUILDER_PORT}:8000" \
  -e "KPUBDATA_BUILDER_API_KEY=${API_KEY}" \
  -e "KPUBDATA_BUILDER_ALLOWED_ORIGINS=${STUDIO_ORIGIN}" \
  "$BUILDER_IMAGE" >/dev/null
docker run -d --name smoke-studio -p "127.0.0.1:${STUDIO_PORT}:8080" \
  -e "BUILDER_API_URL=${BUILDER_URL}" \
  "$STUDIO_IMAGE" >/dev/null

healthz=""
for _ in $(seq 1 60); do
  healthz=$(curl -s -o /dev/null -w '%{http_code}' "${BUILDER_URL}/healthz" || true)
  [ "$healthz" = "200" ] && break
  sleep 1
done
config=""
for _ in $(seq 1 30); do
  config=$(curl -sf "${STUDIO_ORIGIN}/config.js" || true)
  [ -n "$config" ] && break
  sleep 0.5
done

say "Studio"
echo "$config" | grep -q "\"builderApiUrl\": \"${BUILDER_URL}\"" \
  && ok "config.js names the Builder URL" || bad "config.js does not name ${BUILDER_URL}"
echo "$config" | grep -q '"useRealBuilder": "true"' \
  && ok "config.js turns the real Builder on" || bad "config.js does not turn the real Builder on"
csp=$(header "$(curl -sI "${STUDIO_ORIGIN}/")" "Content-Security-Policy")
echo "$csp" | grep -Eq "connect-src [^;]*${BUILDER_URL}( |;|$)" \
  && ok "the page may connect to the Builder origin" || bad "connect-src does not name ${BUILDER_URL}: ${csp}"

say "Builder"
check "Builder answers /healthz" "$healthz" "200"

preflight=$(curl -s -D - -o /dev/null -X OPTIONS "${BUILDER_URL}/builds" \
  -H "Origin: ${STUDIO_ORIGIN}" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: x-api-key")
check "the preflight from Studio's origin is allowed" "$(header "$preflight" "Access-Control-Allow-Origin")" "$STUDIO_ORIGIN"
header "$preflight" "Access-Control-Allow-Headers" | grep -qi 'X-API-Key' \
  && ok "the preflight allows X-API-Key" || bad "the preflight does not allow X-API-Key"

get=$(curl -s -D - -o /dev/null -w 'status=%{http_code}\n' "${BUILDER_URL}/builds" \
  -H "Origin: ${STUDIO_ORIGIN}" -H "X-API-Key: ${API_KEY}")
check "an authenticated request from Studio's origin is answered" "$(echo "$get" | sed -n 's/^status=//p')" "200"
check "and Studio's origin may read it" "$(header "$get" "Access-Control-Allow-Origin")" "$STUDIO_ORIGIN"

other=$(curl -s -D - -o /dev/null -X OPTIONS "${BUILDER_URL}/builds" \
  -H "Origin: http://localhost:18099" -H "Access-Control-Request-Method: GET")
check "an origin Builder was not given is not allowed" "$(header "$other" "Access-Control-Allow-Origin")" ""

say ""
say "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
