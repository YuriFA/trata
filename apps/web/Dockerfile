# syntax=docker/dockerfile:1
#
# Multi-stage web image. Build context is the REPO ROOT (not apps/web):
# the Vite build compiles the workspace TS packages (packages/*) from
# source, so the whole pnpm workspace must be present.
#   docker build -f apps/web/Dockerfile .
#
# Cross-build at native speed: the node builder runs on the BUILD
# platform (dist is platform-independent static files); only the final
# nginx stage targets the deploy platform (--platform linux/amd64).

FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

# Build version logged at startup and cross-checked against /api/health
# (spec: app-version): the deployed image tag (sha-<short>) from the deploy
# pipeline, or `dev` for local builds. Consumed by the Vite `define` in
# vite.config.ts (VITE_APP_VERSION -> __APP_VERSION__).
ARG VERSION=dev
ENV VITE_APP_VERSION=$VERSION

# pnpm comes from the root package.json `packageManager` pin via corepack.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /repo

# Workspace manifests first: `pnpm install` layer stays cached across
# source-only changes. Every workspace package.json must exist for pnpm
# to resolve the workspace graph (deps are only installed for `web`).
# .npmrc (node-linker=hoisted) is repo install config — the image must
# install exactly like the host, or undeclared-at-root transitive
# imports (e.g. workbox-window via vite-plugin-pwa's virtual module)
# stop resolving on a clean install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/dates/package.json packages/dates/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/local-data/package.json packages/local-data/package.json
COPY packages/money/package.json packages/money/package.json
COPY packages/tokens/package.json packages/tokens/package.json
RUN pnpm install --frozen-lockfile --filter web...

COPY . .
# The category-icons drift test imports the canonical mobile config (the
# one file .dockerignore re-includes); its only import is a type from
# @trata/api. The filtered install links workspace packages
# under apps/web only, so give the mobile file the same module resolution
# a full workspace install provides - point its node_modules there.
RUN ln -s /repo/apps/web/node_modules /repo/apps/mobile/node_modules
RUN pnpm -C apps/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
