# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the KUB web artifact.
# Stage 1: build the Vite SPA with pnpm.
# Stage 2: serve the static bundle via nginx:alpine with SPA fallback.
#
# Build context = repo root:
#   docker build -f docs/deploy/Dockerfile \
#     --build-arg VITE_SUPABASE_URL=https://your-project.supabase.co \
#     --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=<YOUR_SUPABASE_PUBLISHABLE_KEY> \
#     --build-arg VITE_VAPID_PUBLIC_KEY= \
#     --build-arg BASE_PATH=/ \
#     -t kub-web:latest .
#
# Do not pass private server secrets here. Vite build args are embedded into
# the browser bundle. The web image is meant to be 100% public.

ARG NODE_VERSION=24-alpine

# ---------- Stage 1: builder ----------
FROM node:${NODE_VERSION} AS builder

ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /repo

# Copy workspace manifests first so the install layer can be cached
# independently of source changes. The pnpm filter resolves transitive
# workspace deps, so every package.json known to the workspace must be present.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY artifacts/kub/package.json            artifacts/kub/package.json
COPY artifacts/api-server/package.json     artifacts/api-server/package.json
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/package.json
COPY lib/api-client-react/package.json     lib/api-client-react/package.json
COPY lib/api-spec/package.json             lib/api-spec/package.json
COPY lib/api-zod/package.json              lib/api-zod/package.json
COPY lib/db/package.json                   lib/db/package.json
COPY scripts/package.json                  scripts/package.json

# Reproducible install - refuse to start if the lockfile is out of date.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --filter @workspace/kub... --frozen-lockfile

# Now bring in the actual source. Real .env* files are excluded by the
# repo-root .dockerignore.
COPY . .

# Vite needs these at build time.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_VAPID_PUBLIC_KEY
ARG BASE_PATH=/

ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
ENV VITE_VAPID_PUBLIC_KEY=${VITE_VAPID_PUBLIC_KEY}
ENV PORT=5173
ENV BASE_PATH=${BASE_PATH}

RUN pnpm --filter @workspace/kub run build

# ---------- Stage 2: runtime ----------
FROM nginx:alpine AS runtime

COPY docs/deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/artifacts/kub/dist/public /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
