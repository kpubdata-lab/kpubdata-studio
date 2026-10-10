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
#   PRIVACY_URL       the deployment's privacy policy, an http(s) page (#838)
#   TERMS_URL         the deployment's terms of use, an http(s) page (#838)
#   SUPPORT_CONTACT   where users write: a mail address, mailto: or an https page (#838)
#   ACCOUNT_URL       the identity provider's account page; <OIDC_ISSUER>/account when unset
#
# It also writes the Content-Security-Policy header nginx sends with the page (#663),
# with this deployment's Builder and OIDC origins added to connect-src (and the issuer
# to frame-src, for the silent SSO iframe). The policy is the one the Vite build puts
# in a meta element (src/shared/config/contentSecurityPolicy.ts) plus frame-ancestors;
# __tests__/contentSecurityPolicy.test.ts keeps the two the same.
#
# A value is written into JavaScript, so it is refused rather than escaped when it
# holds anything a URL or client id has no business holding. Refusing stops the
# container with the reason; escaping would start it with a value nobody meant.
set -eu

out="${KPUBDATA_CONFIG_OUT:-/usr/share/nginx/html/config.js}"
csp_out="${KPUBDATA_CSP_OUT:-/etc/nginx/kpubdata-csp.conf}"

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

privacy="${PRIVACY_URL:-}"
terms="${TERMS_URL:-}"
support="${SUPPORT_CONTACT:-}"
account="${ACCOUNT_URL:-}"
check PRIVACY_URL "$privacy"
check TERMS_URL "$terms"
check SUPPORT_CONTACT "$support"
check ACCOUNT_URL "$account"
# A contact is a bare mail address, a mailto: link or an https page. The page refuses
# any other scheme too (resolveSupportContact); refusing here says so at start instead
# of leaving the screens without a contact.
case "$support" in
  "" | https://* | mailto:*) ;;
  *:*)
    echo "kpubdata-studio: SUPPORT_CONTACT is not a mail address, mailto: or an https URL: ${support}" >&2
    exit 1
    ;;
esac

# scheme://host[:port] of a URL, user info dropped. A URL whose origin is not plainly
# http(s) and a host is refused: it would go into a response header.
origin() {
  name="$1"
  value="$2"
  [ -z "$value" ] && return 0
  o=$(printf '%s' "$value" | sed -E 's#^([A-Za-z][A-Za-z0-9+.-]*://)([^/?#@]*@)?([^/?#]*).*$#\1\3#')
  if ! printf '%s' "$o" | grep -Eq '^https?://(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(:[0-9]+)?$'; then
    echo "kpubdata-studio: ${name} is not an http(s) URL with a plain host: ${value}" >&2
    exit 1
  fi
  printf ' %s' "$o"
}

builder_origin=$(origin BUILDER_API_URL "$builder")
issuer_origin=$(origin OIDC_ISSUER "$issuer")
# These three are only followed as links, so they add nothing to the policy; origin
# is called for its refusal of anything that is not an http(s) URL.
origin PRIVACY_URL "$privacy" > /dev/null
origin TERMS_URL "$terms" > /dev/null
origin ACCOUNT_URL "$account" > /dev/null
local_http="http://localhost:* http://127.0.0.1:*"
policy="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'"
policy="${policy}; connect-src 'self' https: ${local_http}${builder_origin}${issuer_origin}"
policy="${policy}; frame-src 'self' https: ${local_http}${issuer_origin}"
policy="${policy}; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"
policy="${policy}; frame-ancestors 'self'"

cat > "$out" <<JS
// Written at container start by 40-kpubdata-config.sh (#411).
window.__KPUBDATA_CONFIG__ = {
  "builderApiUrl": "${builder}",
  "useRealBuilder": "${real}",
  "oidcIssuer": "${issuer}",
  "oidcClientId": "${client}",
  "privacyUrl": "${privacy}",
  "termsUrl": "${terms}",
  "supportContact": "${support}",
  "accountUrl": "${account}"
};
JS

cat > "$csp_out" <<NGINX
# Written at container start by 40-kpubdata-config.sh (#663).
add_header Content-Security-Policy "${policy}" always;
NGINX

echo "kpubdata-studio: builder=${builder:-<built-in>} real=${real:-<built-in>} oidc=${issuer:-<built-in>}"
