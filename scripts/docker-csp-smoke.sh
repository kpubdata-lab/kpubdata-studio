#!/usr/bin/env bash
# Docker image smoke test (#696): build the image, start it with two different
# BUILDER_API_URLs, and verify the Content-Security-Policy header — its
# existence, the deployment origin in connect-src, and that it does not
# double-apply with the <meta> CSP. A bad origin must refuse to start.
#
# Runs outside CI (manually) and in CI (ci.yml's docker-csm job). Requires a
# Docker daemon. Exits nonzero on the first failure.
set -eu

cd "$(dirname "$0")/.."

IMAGE="kpubdata-studio-csp-smoke"
PASS=0
FAIL=0

say()  { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS + 1)); say "  ok: $*"; }
bad()  { FAIL=$((FAIL + 1)); say "  FAIL: $*" >&2; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected [$3], got [$2])"; fi; }

cleanup() { docker rm -f csp-a csp-b csp-c 2>/dev/null || true; }
trap cleanup EXIT

say "Building image..."
docker build -t "$IMAGE" . >/dev/null

# --- Case 1: a valid BUILDER_API_URL puts the origin in connect-src ---
say "Case 1: valid origin"
docker run -d --name csp-a -e BUILDER_API_URL=https://api.example.org -p 18081:8080 "$IMAGE" >/dev/null
for i in $(seq 1 30); do docker exec csp-a nginx -t 2>/dev/null && break; sleep 0.5; done

header=$(curl -sI http://localhost:18081/ | grep -i '^Content-Security-Policy:' || true)
[ -n "$header" ] && ok "CSP header present" || bad "CSP header missing"

echo "$header" | grep -q 'connect-src' && ok "connect-src present" || bad "connect-src missing"
echo "$header" | grep -q 'https://api.example.org' && ok "deployment origin in connect-src" || bad "deployment origin not in connect-src"

# The meta CSP is turned off in the Docker build (KPUBDATA_CSP_META=off);
# a second policy in the page would double-apply.
body=$(curl -s http://localhost:18081/)
echo "$body" | grep -q 'http-equiv="Content-Security-Policy"' && bad "meta CSP also present (double-apply)" || ok "no meta CSP (header only)"

# --- Case 2: a different origin produces a different header ---
say "Case 2: different origin"
docker run -d --name csp-b -e BUILDER_API_URL=https://builder.other.net -p 18082:8080 "$IMAGE" >/dev/null
for i in $(seq 1 30); do docker exec csp-b nginx -t 2>/dev/null && break; sleep 0.5; done

header_b=$(curl -sI http://localhost:18082/ | grep -i '^Content-Security-Policy:' || true)
echo "$header_b" | grep -q 'https://builder.other.net' && ok "second origin in header" || bad "second origin not in header"
echo "$header_b" | grep -q 'https://api.example.org' && bad "first origin leaked into second deployment" || ok "first origin absent"

# --- Case 3: an invalid origin (injection) refuses to start ---
say "Case 3: invalid origin"
set +e
docker run -d --name csp-c -e 'BUILDER_API_URL=javascript:alert(1)//' -p 18083:8080 "$IMAGE" >/dev/null 2>&1
sleep 3
docker inspect csp-c --format='{{.State.Running}}' 2>/dev/null | grep -q 'true'
running=$?
set -e
if [ $running -ne 0 ]; then ok "invalid origin refused to start"; else bad "invalid origin started (vulnerability)"; fi

say ""
say "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ] || exit 1
