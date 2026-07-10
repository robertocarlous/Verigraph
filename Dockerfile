# Verigraph ASP — production image.
#
# The running server never reads the Hardhat build artifact (config.ts hardcodes
# its own minimal ERC-20 ABI) — it only needs the compiled backend JS and the
# real `onchainos` CLI binary (session-tier calls: agent identity resolution,
# reputation/feedback-list). Hardhat/contract compilation stays a local/dev-only
# step (`npm run compile:contracts`), not part of this image.
FROM node:20-bookworm-slim

# build-essential + python3: needed transiently to compile keccak's native
# binding (a hardhat devDependency) during `npm ci`. curl: installs the
# onchainos CLI. All required only at build time; final image size isn't a
# hackathon-deadline priority.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Official onchainos CLI (github.com/okx/onchainos-skills) — installs to
# ~/.local/bin per its own installer.
RUN curl -sSL https://raw.githubusercontent.com/okx/onchainos-skills/main/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY backend ./backend
COPY agent ./agent
COPY contract/DemoEIP3009Token.sol ./contract/DemoEIP3009Token.sol

RUN npm run build

ENV NODE_ENV=production
EXPOSE 8402
CMD ["node", "dist/backend/src/server.js"]
