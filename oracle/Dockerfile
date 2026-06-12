# Voltray settlement daemon (see docs/DEPLOY.md "Oracle deployment").
# Runs TypeScript directly via tsx — no build step for a worker this small.
FROM node:24-slim

WORKDIR /app

RUN npm install -g pnpm@11

# Install deps first so source edits don't bust the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

# Secrets (ORACLE_SECRET_KEY, CHARGER_SECRET_KEY) come from the platform secret store
# at runtime — never from a baked-in .env (see .dockerignore and docs/TRUST.md §7.3).
#
# Single node process loading tsx as an ESM loader — `pnpm daemon` would stack
# pnpm → tsx → node and OOM a 256MB machine.
CMD ["node", "--import", "tsx", "src/daemon.ts"]
