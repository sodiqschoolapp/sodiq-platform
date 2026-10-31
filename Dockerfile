# The production image of the API and the worker (task 10.4; docs/deploy.md,
# Production). Render builds it for the services of render.production.yaml;
# the job `image` of .github/workflows/deploy-production.yml builds it on the
# runner and proves it makes a PDF before anything is deployed.
#
# Owner's answer 15 (docs/decisions.md, Decided ahead for Phase 10): run as
# Docker with Chromium, so Print and PDF work in production. The test
# environment stays on Render's Node runtime (render.yaml).
#
# The base image follows .node-version (24) and is pinned by digest;
# docker-image.test.ts keeps the pnpm version equal to packageManager and the
# Chromium installer equal to apps/api's playwright-core.

FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base
WORKDIR /app
ENV CI=true

# Everything installed and built: the API, the packages and the web app.
FROM base AS build
# Render passes a service's variables to a Docker build as arguments; the web
# app's error reports and release are read at build time (apps/web/vite.config.ts).
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_ENVIRONMENT
ARG RENDER_GIT_COMMIT
# Task 10.2a: where the web app's source maps go (docs/monitoring.md). The token is
# a Render Secret File mounted as a build secret below, never an argument, so it
# is in no layer and no history of the image.
ARG SENTRY_ORG
ARG SENTRY_PROJECT
# sentry-cli checks sentry.io's certificate against the system's trusted roots,
# which the slim image lacks: the upload of 31 October 2026 failed with "unable
# to get local issuer certificate". Node carries roots of its own; the CLI does not.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npx -y pnpm@12.8.1 install --frozen-lockfile
# A declared argument is in the environment of the commands below; one not
# given stays unset (the image check builds without them). No source map is ever
# served: those not uploaded (and deleted by the upload) are deleted here.
RUN --mount=type=secret,id=sentry-auth-token,required=false \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry-auth-token 2>/dev/null || true)" \
    npx -y pnpm@12.8.1 turbo run build --filter=@sodiq/api --filter=@sodiq/web \
    && find apps/web/dist -name '*.map' -delete

# The production dependencies of the API and its workspace packages only, at
# the repository's own paths (no `pnpm deploy`, which moves the API to the
# root of its output).
FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/calc/package.json packages/calc/
COPY packages/shared/package.json packages/shared/
COPY packages/timetable-rules/package.json packages/timetable-rules/
RUN npx -y pnpm@12.8.1 install --frozen-lockfile --prod --filter "@sodiq/api..."

FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    WEB_FILES=apps/web/dist \
    NODE_OPTIONS=--enable-source-maps \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=dependencies /app ./
COPY --from=build /app/packages/calc/dist packages/calc/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/timetable-rules/dist packages/timetable-rules/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
# The letterhead logo of the PDFs is read from the web app's brand folder
# (apps/api/src/http/pdf.ts, letterheadLogo).
COPY --from=build /app/apps/web/public/brand apps/web/public/brand
# Chromium for the PDFs, by the playwright-core the API runs, with its system
# packages; as root, into a folder the service's user can read. CHROMIUM_PATH
# stays unset: playwright-core finds its own browser there.
RUN cd apps/api && node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /ms-playwright
USER node
EXPOSE 3000
# The API; the worker's service runs `node apps/api/dist/worker.js` instead.
CMD ["node", "apps/api/dist/main.js"]
