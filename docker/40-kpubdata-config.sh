#!/bin/sh
# Write /config.js from the container's environment at start (#411).
#
# The image is the same for every deployment; the Builder URL and OIDC realm are
# not. nginx's entrypoint runs every script in /docker-entrypoint.d/ before it
# starts, so this runs once per container start and the page reads the result as
# window.__KPUBDATA_CONFIG__ (src/shared/config/runtime.ts).
#
#   BUILDER_API_URL   Builder base URL the browser calls, e.g. https://api.example.org
#   USE_REAL_BUILDER  "true" to call Builder; anything else keeps the built-in demo data.
#                     Defaults to "true" when BUILDER_API_URL is set.
#   OIDC_ISSUER       e.g. https://sso.example.org/realms/kpubdata
#   OIDC_CLIENT_ID    public SPA client id — never a secret
#
# A value is written into JavaScript, so it is refused rather than escaped when it
# holds anything a URL or client id has no business holding. Refusing stops the
# container with the reason; escaping would start it with a value nobody meant.
set -eu

out="${KPUBDATA_CONFIG_OUT:-/usr/share/nginx/html/config.js}"

check() {
  name="$1"
  value="$2"
  case "$value" in
    *[!A-Za-z0-9:/._~%?#\&=+@,\;-]*)
      echo "kpubdata-studio: ${name} holds a character that is not allowed in it: ${value}" >&2
      exit 1
      ;;
  esac
}

builder="${BUILDER_API_URL:-}"
issuer="${OIDC_ISSUER:-}"
client="${OIDC_CLIENT_ID:-}"
if [ -n "${USE_REAL_BUILDER:-}" ]; then
  real="$USE_REAL_BUILDER"
elif [ -n "$builder" ]; then
  real="true"
else
  real=""
fi

check BUILDER_API_URL "$builder"
check USE_REAL_BUILDER "$real"
check OIDC_ISSUER "$issuer"
check OIDC_CLIENT_ID "$client"

cat > "$out" <<JS
// Written at container start by 40-kpubdata-config.sh (#411).
window.__KPUBDATA_CONFIG__ = {
  "builderApiUrl": "${builder}",
  "useRealBuilder": "${real}",
  "oidcIssuer": "${issuer}",
  "oidcClientId": "${client}"
};
JS

echo "kpubdata-studio: builder=${builder:-<built-in>} real=${real:-<built-in>} oidc=${issuer:-<built-in>}"
