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
#     ghcr.io/yeongseon/kpubdata-studio:<version>
#
# Builder must list this origin in KPUBDATA_BUILDER_ALLOWED_ORIGINS — the browser
# calls it directly.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .
# Served at the root. The default production base (/kpubdata-studio/) is for GitHub Pages.
RUN npx vite build --base /

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 docker/40-kpubdata-config.sh /docker-entrypoint.d/40-kpubdata-config.sh
COPY --from=build /app/dist /usr/share/nginx/html
# The only file the container writes, and the only one its user may.
USER root
RUN chown 101:101 /usr/share/nginx/html/config.js
USER 101
EXPOSE 8080
