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

# ── Stage 3: Production runtime ──────────────────────────
FROM node:20-slim
WORKDIR /app

# Install production dependencies (includes native module compilation)
COPY package.json package-lock.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && npm ci --omit=dev --ignore-scripts \
    && npm rebuild better-sqlite3 \
    && apt-get purge -y python3 make g++ && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* /root/.npm

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
