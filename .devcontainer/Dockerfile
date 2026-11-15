# Voltray development container: Node + pnpm (web, oracle), Sui CLI (contracts), flyctl (oracle deploy).
# This is the *development* image. The production oracle image is oracle/Dockerfile.
FROM mcr.microsoft.com/devcontainers/javascript-node:24-bookworm

# Same pnpm major as oracle/Dockerfile, so dev and deploy resolve the lockfiles identically.
RUN su node -c "npm install -g pnpm@11"

# Sui CLI: prebuilt testnet binary. Bump SUI_VERSION to follow the network, then rebuild the container.
# The release archive also ships node/bridge/debug binaries; only `sui` is extracted.
ARG SUI_VERSION=testnet-v1.84.0
RUN curl -fsSL "https://github.com/MystenLabs/sui/releases/download/${SUI_VERSION}/sui-${SUI_VERSION}-ubuntu-x86_64.tgz" \
    | tar -xz -C /usr/local/bin ./sui

# flyctl, for `fly deploy` (docs/DEPLOY.md "Oracle deployment").
RUN curl -fsSL https://fly.io/install.sh | FLYCTL_INSTALL=/usr/local sh

# Mount points for the named volumes in devcontainer.json. A new volume copies the ownership of
# the directory it is first mounted on, so these must exist and belong to the dev user.
RUN mkdir -p /home/node/.sui /claude-config \
    && chown node:node /home/node/.sui /claude-config
