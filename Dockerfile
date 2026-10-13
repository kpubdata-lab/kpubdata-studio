# syntax=docker/dockerfile:1

# KPubData Studio — static build served by nginx (#411).
#
# One image for every deployment: the Builder URL and OIDC settings are read from
# the environment when the container starts (docker/40-kpubdata-config.sh), not
# baked in here.
#
#   docker run -p 8080:8080 \
#     -e BUILDER_API_URL=https://api.example.org \
#     -e OIDC_ISSUER=https://sso.example.org/realms/kpubdata \
#     -e OIDC_CLIENT_ID=kpubdata-studio \
#     ghcr.io/kpubdata-lab/kpubdata-studio:<version>
#
# Builder must list this origin in KPUBDATA_BUILDER_ALLOWED_ORIGINS — the browser
# calls it directly.

# The site is the same files on every platform, so it is built once, natively, and only
# the nginx stage is per platform: an arm64 `npm ci` and Vite build under emulation
# would take many times as long for the same output (#904).
# The Node major is the LTS line `.nvmrc` names and CI's test matrix runs, so the site
# that ships is built by a toolchain CI has exercised (#981). An odd-numbered major is
# never LTS. __tests__/localToolchainGate.test.ts fails when this line drifts, and
# Dependabot does not propose a new Node major here: moving it is a change to `.nvmrc`,
# the CI matrix and this line together.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .
# Served at the root. The default production base (/kpubdata-studio/) is for GitHub Pages.
# No Content-Security-Policy meta: nginx sends the policy as a header with this
# deployment's origins (40-kpubdata-config.sh), and a meta copy would narrow it (#663).
RUN KPUBDATA_CSP_META=off npx vite build --base /

FROM nginxinc/nginx-unprivileged:1.31-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/kpubdata-security-headers.conf
COPY --chmod=755 docker/40-kpubdata-config.sh /docker-entrypoint.d/40-kpubdata-config.sh
COPY --from=build /app/dist /usr/share/nginx/html
# The only files the container writes, and the only ones its user may: the runtime
# config and the Content-Security-Policy header with this deployment's origins (#663).
USER root
# The base tag's Alpine packages are as old as its last rebuild; take the fixes published
# since. security.yml's image scan fails on a HIGH or CRITICAL vulnerability that has a
# fix (kpubdata-builder#1107) — 43 of them, in curl, OpenSSL and c-ares, without this line.
RUN apk upgrade --no-cache
RUN chown 101:101 /usr/share/nginx/html/config.js \
 && touch /etc/nginx/kpubdata-csp.conf \
 && chown 101:101 /etc/nginx/kpubdata-csp.conf
USER 101
EXPOSE 8080
