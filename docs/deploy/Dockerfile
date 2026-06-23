# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the KUB web artifact.
# Stage 1: install the pnpm workspace dependencies.
# Stage 2: build the Vite SPA.
# Stage 3: serve the static bundle via nginx:alpine with SPA fallback.
#
# Build context = repo root:
#   docker build -f docs/deploy/Dockerfile \
#     --build-arg VITE_SUPABASE_URL=https://your-project.supabase.co \
#     --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=<YOUR_SUPABASE_PUBLISHABLE_KEY> \
#     --build-arg VITE_SUPABASE_ANON_KEY=<YOUR_SUPABASE_ANON_KEY> \
#     --build-arg VITE_VAPID_PUBLIC_KEY= \
#     --build-arg VITE_AUTH_CAPTCHA_PROVIDER=turnstile \
#     --build-arg VITE_AUTH_CAPTCHA_SITE_KEY=<YOUR_PUBLIC_CAPTCHA_SITE_KEY> \
#     --build-arg VITE_AUTH_GATEWAY_URL= \
#     --build-arg BASE_PATH=/ \
#     --build-arg PORT=5173 \
#     -t kub-web:latest .
#
# Do not pass private server secrets here. Vite build args are embedded into
# the browser bundle. The web image is meant to be 100% public.

ARG NODE_VERSION=24-bookworm-slim

# ---------- Shared Node base ----------
FROM node:${NODE_VERSION} AS base

ENV PNPM_HOME=/root/.local/share/pnpm \
    PATH=/root/.local/share/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /app

RUN corepack enable

# ---------- Stage 1: deps ----------
FROM base AS deps

# Copy workspace manifests first so the install layer can be cached independently
# of source changes. Corepack reads the root packageManager field when pnpm runs.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY artifacts/kub/package.json            artifacts/kub/package.json
COPY artifacts/api-server/package.json     artifacts/api-server/package.json
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/package.json
COPY lib/api-client-react/package.json     lib/api-client-react/package.json
COPY lib/api-spec/package.json             lib/api-spec/package.json
COPY lib/api-zod/package.json              lib/api-zod/package.json
COPY lib/db/package.json                   lib/db/package.json
COPY scripts/package.json                  scripts/package.json

# Reproducible full workspace install. The web app has workspace dependencies,
# and Coolify builds from a clean root context, so avoid a brittle filtered
# install here.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm --version && pnpm install --frozen-lockfile

# ---------- Stage 2: build ----------
FROM base AS build

# Bring in installed dependencies and then the source. Real .env* files are
# excluded by the repo-root .dockerignore.
COPY --from=deps /app/ ./
COPY . .

# Vite needs these at build time.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_VAPID_PUBLIC_KEY
ARG VITE_AUTH_CAPTCHA_PROVIDER
ARG VITE_AUTH_CAPTCHA_SITE_KEY
ARG VITE_AUTH_GATEWAY_URL
ARG BASE_PATH=/
ARG PORT=5173

ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY} \
    VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY} \
    VITE_VAPID_PUBLIC_KEY=${VITE_VAPID_PUBLIC_KEY} \
    VITE_AUTH_CAPTCHA_PROVIDER=${VITE_AUTH_CAPTCHA_PROVIDER} \
    VITE_AUTH_CAPTCHA_SITE_KEY=${VITE_AUTH_CAPTCHA_SITE_KEY} \
    VITE_AUTH_GATEWAY_URL=${VITE_AUTH_GATEWAY_URL} \
    BASE_PATH=${BASE_PATH} \
    PORT=${PORT} \
    NODE_ENV=production

RUN set -eu; \
    export PORT="${PORT:-5173}"; \
    export BASE_PATH="${BASE_PATH:-/}"; \
    export VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-}"; \
    export VITE_SUPABASE_PUBLISHABLE_KEY="${VITE_SUPABASE_PUBLISHABLE_KEY:-}"; \
    export VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}"; \
    export VITE_VAPID_PUBLIC_KEY="${VITE_VAPID_PUBLIC_KEY:-}"; \
    export VITE_AUTH_CAPTCHA_PROVIDER="${VITE_AUTH_CAPTCHA_PROVIDER:-}"; \
    export VITE_AUTH_CAPTCHA_SITE_KEY="${VITE_AUTH_CAPTCHA_SITE_KEY:-}"; \
    export VITE_AUTH_GATEWAY_URL="${VITE_AUTH_GATEWAY_URL:-}"; \
    pnpm --filter @workspace/kub run build

RUN pnpm --filter @workspace/api-server run build

# ---------- Optional API/worker runtime ----------
FROM base AS api-runtime

ENV NODE_ENV=production \
    PORT=8096

COPY --from=build /app/ ./

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 8096

CMD ["sh", "-lc", "if [ -f /run/secrets/letscube-infra.env ]; then set -a; . /run/secrets/letscube-infra.env; set +a; fi; PORT=8096; : ${MEDIA_VARIANTS_WORKER_ENABLED:=1}; export PORT MEDIA_VARIANTS_WORKER_ENABLED; exec node --enable-source-maps artifacts/api-server/dist/index.mjs"]

# ---------- Stage 3: runtime ----------
FROM nginx:alpine AS runtime

COPY docs/deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/artifacts/kub/dist/public /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
