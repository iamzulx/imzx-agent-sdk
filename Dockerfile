# ── Stage 1: Install dependencies ──────────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts --production=false

# ── Stage 2: Production image ─────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app

# Copy deps from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy project source
COPY package.json ./
COPY bin/ ./bin/
COPY domain/ ./domain/
COPY application/ ./application/
COPY adapters/ ./adapters/
COPY interfaces/ ./interfaces/

# Data directory for persistent memory, skills, metrics
RUN mkdir -p /app/.imzx/skills /app/.imzx/logs

EXPOSE 3000

CMD ["node", "--import", "tsx", "interfaces/cli/cli-handler.ts", "serve", "--port", "3000"]
