#!/usr/bin/env bash
# Docker image smoke test (#696): build the image, start it with two different
# BUILDER_API_URLs, and verify the Content-Security-Policy header — its
# existence, the deployment origin in connect-src, and that it does not
# double-apply with the <meta> CSP. A bad origin must refuse to start.
# Ask KPubData is off unless the operator opts in, and connect-src names origins instead
# of allowing every https host (#798).
# Also: the security headers every response carries, and the page's lang (#841), and
# that a browser refuses to show the page in a frame of another origin
# (kpubdata-builder#1107) when CSP_SMOKE_BROWSER names a Chrome or Chromium.
# And that nginx names no version and sends text gzipped (#994).
#
# Runs outside CI (manually) and in CI (ci.yml's docker-csp job). Requires a
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

cleanup() { docker rm -f csp-a csp-b csp-c csp-d csp-e 2>/dev/null || true; }
trap cleanup EXIT

# Wait until the container answers on its port, not until its configuration is valid.
# `nginx -t` passes as soon as the files are in place — the image ships an empty CSP file,
# so before the entrypoint has written the real one — and before nginx listens: the first
# curl then met a closed port (exit 56) and every check of that case failed. A container
# that never answers has its log printed and fails the script there (`set -e`): the checks
# after it would only report the same thing again, less plainly.
wait_until_serving() {
  name="$1"
  port="$2"
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "http://localhost:${port}/"; then return 0; fi
    sleep 0.5
  done
  say "  ${name} did not answer on port ${port} within 30 s; its log:" >&2
  docker logs "$name" >&2 2>&1 || true
  return 1
}

# CI builds the image beforehand with a layer cache (ci.yml) and sets CSP_SMOKE_IMAGE_BUILT.
if [ -z "${CSP_SMOKE_IMAGE_BUILT:-}" ]; then
  say "Building image..."
  docker build -t "$IMAGE" . >/dev/null
fi

# --- Case 1: a valid BUILDER_API_URL puts the origin in connect-src ---
say "Case 1: valid origin"
docker run -d --name csp-a -e BUILDER_API_URL=https://api.example.org -p 18081:8080 "$IMAGE" >/dev/null
wait_until_serving csp-a 18081

header=$(curl -sI http://localhost:18081/ | grep -i '^Content-Security-Policy:' || true)
[ -n "$header" ] && ok "CSP header present" || bad "CSP header missing"

echo "$header" | grep -q 'connect-src' && ok "connect-src present" || bad "connect-src missing"
echo "$header" | grep -q 'https://api.example.org' && ok "deployment origin in connect-src" || bad "deployment origin not in connect-src"
echo "$header" | grep -Eq "connect-src [^;]*https:( |;)" && bad "connect-src allows every https host" || ok "connect-src does not allow every https host"
curl -s http://localhost:18081/config.js | grep -q '"assistantEnabled": "false"' && ok "Ask KPubData is off by default" || bad "Ask KPubData is not off by default"

# The meta CSP is turned off in the Docker build (KPUBDATA_CSP_META=off);
# a second policy in the page would double-apply.
body=$(curl -s http://localhost:18081/)
echo "$body" | grep -q 'http-equiv="Content-Security-Policy"' && bad "meta CSP also present (double-apply)" || ok "no meta CSP (header only)"

# The headers every response carries (#841), on the page and on the three other kinds of
# response nginx gives: a location that left the include out would drop them there.
for path in / /assets/none.js /config.js /silent-check-sso.html; do
  headers=$(curl -sI "http://localhost:18081${path}")
  echo "$headers" | grep -qi '^Referrer-Policy: strict-origin-when-cross-origin' && ok "Referrer-Policy on ${path}" || bad "Referrer-Policy missing on ${path}"
  echo "$headers" | grep -qi '^Permissions-Policy: .*camera=()' && ok "Permissions-Policy on ${path}" || bad "Permissions-Policy missing on ${path}"
  echo "$headers" | grep -qi '^Strict-Transport-Security: max-age=31536000' && ok "Strict-Transport-Security on ${path}" || bad "Strict-Transport-Security missing on ${path}"
  echo "$headers" | grep -qi '^X-Content-Type-Options: nosniff' && ok "X-Content-Type-Options on ${path}" || bad "X-Content-Type-Options missing on ${path}"
done
echo "$body" | grep -q '<html lang="ko"' && ok "the page declares its language" || bad "the page does not declare lang=\"ko\""

# A hashed bundle is cached for a year, a missing one not at all (#868).
asset=$(docker exec csp-a sh -c 'ls /usr/share/nginx/html/assets | head -n 1')
cache_found=$(curl -sI "http://localhost:18081/assets/${asset}" | grep -i '^Cache-Control:' | tr -d '\r' || true)
check "Cache-Control on a bundle that exists" "$cache_found" "Cache-Control: public, max-age=31536000, immutable"
cache_missing=$(curl -sI http://localhost:18081/assets/none.js | grep -i '^Cache-Control:' | tr -d '\r' || true)
check "Cache-Control on a missing bundle" "$cache_missing" "Cache-Control: no-store"

# No version in the Server header or on nginx's own error pages, and text compressed on
# the way out with the same type, caching and fallback as before (#994).
server=$(curl -sI http://localhost:18081/ | grep -i '^Server:' | tr -d '\r' || true)
check "Server header names no version" "$server" "Server: nginx"
curl -s http://localhost:18081/assets/none.js | grep -q 'nginx/[0-9]' && bad "error page names the nginx version" || ok "error page names no version"

js=$(docker exec csp-a sh -c 'cd /usr/share/nginx/html/assets && ls -S *.js | head -n 1')
js_headers=$(curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip' "http://localhost:18081/assets/${js}" | tr -d '\r')
echo "$js_headers" | grep -qi '^Content-Encoding: gzip$' && ok "a bundle is sent gzipped" || bad "a bundle is not sent gzipped"
echo "$js_headers" | grep -qi '^Content-Type: application/javascript' && ok "a gzipped bundle keeps its type" || bad "a gzipped bundle lost its type"
echo "$js_headers" | grep -qi '^Vary: Accept-Encoding' && ok "a gzipped bundle varies on Accept-Encoding" || bad "Vary: Accept-Encoding missing on a bundle"
echo "$js_headers" | grep -qi '^Cache-Control: public, max-age=31536000, immutable' && ok "a gzipped bundle is still cached for a year" || bad "a gzipped bundle lost its Cache-Control"
js_raw=$(curl -s -o /dev/null -w '%{size_download}' "http://localhost:18081/assets/${js}")
js_gzip=$(curl -s -o /dev/null -w '%{size_download}' -H 'Accept-Encoding: gzip' "http://localhost:18081/assets/${js}")
if [ "$js_gzip" -gt 0 ] && [ $((js_gzip * 2)) -lt "$js_raw" ]; then
  ok "a bundle transfers in less than half its size (${js_gzip} of ${js_raw} bytes)"
else
  bad "a bundle transfers in ${js_gzip} of ${js_raw} bytes, not under half"
fi
plain=$(curl -sI "http://localhost:18081/assets/${js}" | grep -ci '^Content-Encoding:' || true)
check "a client that does not ask for gzip gets the bundle as it is" "$plain" "0"

# A file that is compressed already is sent as it is, gzip asked for or not. The build
# ships none, so one of each kind is put in for the check: 4 KiB is over gzip_min_length,
# and nginx goes by the extension, not the content.
work_bin=$(mktemp -d)
head -c 4096 /dev/urandom > "$work_bin/compressed.png"
cp "$work_bin/compressed.png" "$work_bin/compressed.woff2"
for file in compressed.png compressed.woff2; do
  docker cp "$work_bin/$file" "csp-a:/usr/share/nginx/html/assets/$file" >/dev/null
  enc=$(curl -sI -H 'Accept-Encoding: gzip' "http://localhost:18081/assets/$file" | grep -ci '^Content-Encoding:' || true)
  check "an already compressed ${file##*.} is not compressed again" "$enc" "0"
done
rm -rf "$work_bin"

# The page fallback still serves index.html for a client-side route, now gzipped, with
# its policy and no caching.
route_headers=$(curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip' http://localhost:18081/runs/some-run | tr -d '\r')
echo "$route_headers" | grep -q '^HTTP/1.1 200' && ok "a client-side route is answered" || bad "a client-side route is not answered 200"
echo "$route_headers" | grep -qi '^Content-Type: text/html' && ok "a client-side route is the page" || bad "a client-side route is not HTML"
echo "$route_headers" | grep -qi '^Content-Security-Policy:' && ok "a client-side route keeps its policy" || bad "a client-side route lost its policy"
echo "$route_headers" | grep -qi '^Cache-Control: no-cache' && ok "a client-side route is not cached" || bad "a client-side route lost Cache-Control: no-cache"
curl -s --compressed http://localhost:18081/runs/some-run | grep -q '<html lang="ko"' && ok "a client-side route decompresses to the page" || bad "a client-side route is not the page"

# --- Case 2: a different origin produces a different header ---
say "Case 2: different origin"
docker run -d --name csp-b -e BUILDER_API_URL=https://builder.other.net -p 18082:8080 "$IMAGE" >/dev/null
wait_until_serving csp-b 18082

header_b=$(curl -sI http://localhost:18082/ | grep -i '^Content-Security-Policy:' || true)
echo "$header_b" | grep -q 'https://builder.other.net' && ok "second origin in header" || bad "second origin not in header"
echo "$header_b" | grep -q 'https://api.example.org' && bad "first origin leaked into second deployment" || ok "first origin absent"

# --- Case 4: a page of another origin cannot frame Studio (kpubdata-builder#1107) ---
# The page's policy says frame-ancestors 'self'; this asks a real browser whether it
# holds. A local file is another origin to every frame in it. Chrome writes one console
# line per frame it refuses, naming the frame's origin and the directive, so the two
# guarded frames are on the first container and the one that must load is on the second:
# /config.js carries no policy, and without it a browser that refused every frame — or a
# log read wrongly — would pass.
if [ -n "${CSP_SMOKE_BROWSER:-}" ]; then
  say "Case 4: framing from another origin"
  work=$(mktemp -d)
  cat > "$work/framing.html" <<HTML
<!doctype html>
<title>frame check</title>
<iframe src="http://localhost:18081/"></iframe>
<iframe src="http://localhost:18081/silent-check-sso.html"></iframe>
<iframe src="http://localhost:18082/config.js"></iframe>
HTML
  control=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:18082/config.js || true)
  check "the unguarded address answers" "$control" "200"
  "$CSP_SMOKE_BROWSER" --headless=new --no-sandbox --disable-gpu --no-first-run \
    "--user-data-dir=$work/profile" --enable-logging=stderr --v=0 \
    --virtual-time-budget=10000 --dump-dom "file://$work/framing.html" \
    > /dev/null 2> "$work/browser.log" || true
  refused_a=$(grep 'frame-ancestors' "$work/browser.log" | grep -c 'http://localhost:18081' || true)
  refused_b=$(grep 'frame-ancestors' "$work/browser.log" | grep -c 'http://localhost:18082' || true)
  check "the browser refuses to frame the page and silent-check-sso.html" "$refused_a" "2"
  check "the browser frames a response without the policy" "$refused_b" "0"
  if [ "$refused_a" != "2" ] || [ "$refused_b" != "0" ]; then tail -n 40 "$work/browser.log" >&2; fi
  rm -rf "$work" 2>/dev/null || true
else
  say "Case 4: not run (CSP_SMOKE_BROWSER is not set), so no browser was asked to frame the page"
fi

# --- Case 5: an operator who turns Ask KPubData on names the AI origins it may reach (#798) ---
say "Case 5: Ask KPubData on, with an allowed origin"
docker run -d --name csp-d -e BUILDER_API_URL=https://api.example.org -e ASSISTANT_ENABLED=true \
  -e ASSISTANT_ALLOWED_ORIGINS=https://llm.example.org -p 18084:8080 "$IMAGE" >/dev/null
wait_until_serving csp-d 18084
header_d=$(curl -sI http://localhost:18084/ | grep -i '^Content-Security-Policy:' || true)
echo "$header_d" | grep -Eq "connect-src [^;]*https://llm.example.org( |;)" && ok "allowed AI origin in connect-src" || bad "allowed AI origin not in connect-src: ${header_d}"
echo "$header_d" | grep -Eq "connect-src [^;]*https:( |;)" && bad "connect-src allows every https host" || ok "connect-src still names its origins"
curl -s http://localhost:18084/config.js | grep -q '"assistantAllowedOrigins": "https://llm.example.org"' && ok "allowed origins reach the page" || bad "allowed origins missing from config.js"

say "Case 6: Ask KPubData on without an allowed origin"
set +e
docker run -d --name csp-e -e ASSISTANT_ENABLED=true -p 18085:8080 "$IMAGE" >/dev/null 2>&1
sleep 3
docker inspect csp-e --format='{{.State.Running}}' 2>/dev/null | grep -q 'true'
running_e=$?
set -e
if [ $running_e -ne 0 ]; then ok "no allowed origin refused to start"; else bad "started with Ask KPubData on and no allowed origin"; fi

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
