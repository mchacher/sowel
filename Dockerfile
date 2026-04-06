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
COPY ui/ ./
RUN npm run build

# ── Stage 3: Production runtime (Debian Trixie for Python 3.13+) ─
FROM debian:trixie-slim
WORKDIR /app

# Install Node.js 20 + Python 3.13 + build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates python3 python3-venv make g++ \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

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

# Prepare directories
RUN mkdir -p data plugins

ENV NODE_ENV=production
ENV SQLITE_PATH=/app/data/sowel.db

EXPOSE 3000

CMD ["node", "dist/index.js"]
