# ============================================================
# Sowel — Multi-stage Docker build
# ============================================================

# ── Stage 1: Build Backend ────────────────────────────────
FROM node:20 AS backend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

# ── Stage 2: Build UI ────────────────────────────────────
FROM node:20-slim AS ui-build
WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
# Design system tokens are imported from ui/src/index.css via ../../design-system/
# (spec 094). The folder lives outside ui/ so copy it explicitly.
COPY design-system/ /app/design-system/
# The shared binding-candidates module is imported from ui/src/lib via
# ../../../src/shared/ (spec 150) — same out-of-ui/ situation as the design
# system: copy it explicitly so tsc/vite resolve it inside this stage.
COPY src/shared/ /app/src/shared/
COPY ui/ ./
RUN npm run build

# ── Stage 3: Production runtime (Debian Trixie for Python 3.13+) ─
FROM debian:trixie-slim
WORKDIR /app

# Install Node.js 20 + Python 3.13 + build tools + gosu (for entrypoint privilege drop)
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates python3 python3-venv make g++ gosu \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create non-root sowel user (uid/gid 1000). The entrypoint drops to this user
# at runtime, after fixing volume ownership idempotently. See docker-entrypoint.sh.
RUN groupadd -g 1000 sowel && useradd -u 1000 -g 1000 -m -s /bin/bash sowel

# Install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm rebuild better-sqlite3 \
    && apt-get purge -y make g++ && apt-get autoremove -y \
    && rm -rf /root/.npm

# Copy compiled backend
COPY --from=backend-build /app/dist/ dist/

# Copy built UI
COPY --from=ui-build /app/ui/dist/ ui-dist/

# Copy migrations + plugin registry
COPY migrations/ migrations/
COPY plugins/registry.json plugins/registry.json

# Copy package.json (for version reading)
COPY package.json ./

# Prepare directories (ownership fixed at runtime by entrypoint)
RUN mkdir -p data plugins

# Entrypoint script: chown data/plugins then drop to sowel user via gosu
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production
ENV SQLITE_PATH=/app/data/sowel.db

# No USER directive — entrypoint controls the privilege drop so existing
# root-owned volumes from a previous version can be re-chowned transparently.

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
