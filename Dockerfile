# NoteBridge: one long-running Node server. The entailment model (about 160 MB, run with ONNX) does not
# fit Edge or serverless functions: it must load once per process and stay in memory, so this is a
# container, not a function. The models are baked into the image so the first run needs no network.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Pre-fetch both models into .cache/models (the folder the app reads).
RUN npm run models:fetch
# fake mode: building must not need any provider key
RUN LLM_MODE=fake npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NOTERISER_OFFLINE=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    NOTERISER_DB=/app/data/noteriser.db
WORKDIR /app
# next.config.ts is TypeScript, so `typescript` (a dev dependency) must be present at start-up.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/.cache/models ./.cache/models
COPY --from=build --chown=node:node /app/package.json /app/next.config.ts /app/tsconfig.json ./
COPY --from=build --chown=node:node /app/fixtures ./fixtures
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Set LLM_MODE=live and the provider variables (see .env.example) at `docker run`; never bake keys in.
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
