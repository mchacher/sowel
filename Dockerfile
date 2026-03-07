# ── Stage 1: Build UI ──────────────────────────────────────
FROM node:20-slim AS ui-build
WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

# ── Stage 2: Build Backend ─────────────────────────────────
FROM node:20-slim AS backend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

# ── Stage 3: Production ───────────────────────────────────
FROM node:20-slim AS production
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Clean up build tools after native modules are compiled
RUN apt-get purge -y python3 make g++ && apt-get autoremove -y

# Copy compiled backend
COPY --from=backend-build /app/dist/ dist/

# Copy built UI
COPY --from=ui-build /app/ui/dist/ ui-dist/

# Copy migrations and recipes
COPY migrations/ migrations/
COPY recipes/ recipes/

# Data volume (SQLite + JWT secret)
VOLUME /app/data

ENV NODE_ENV=production
ENV SQLITE_PATH=/app/data/sowel.db

EXPOSE 3000

CMD ["node", "dist/index.js"]
