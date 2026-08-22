# Node 24 runs TypeScript directly, so there is no compile step — but there are two
# stages anyway, and the reason is the CVE surface rather than build artefacts.
#
# npm ships its own bundled dependency tree inside the Node image (tar, undici,
# brace-expansion, ip-address, …). Nothing at runtime uses npm: the entrypoint is `node`
# and so is the health check. Leaving it in the final image would mean carrying — and
# having to triage — advisories for code that never executes. The first Trivy run against
# this image found seven fixable HIGH/CRITICAL findings, every one of them inside npm's
# own tree. So npm installs the dependencies in the builder stage and does not travel to
# the runtime stage.
#
# The base image is Debian slim rather than Alpine. Both were tested under linux/arm64
# emulation and both resolve prebuilt native modules without a toolchain, so this is a
# preference rather than a necessity: musl's DNS resolver differs from glibc's, and this
# project makes DNS a prerequisite. See ADR-004.

# ── Builder: resolve dependencies ─────────────────────────────────────────────
FROM node:26-bookworm-slim AS deps

WORKDIR /app

# Dependencies first, so the layer stays cached when only source changes.
COPY package.json package-lock.json ./

# `npm ci` and not `npm install`: it fails when the manifest and the lock file disagree,
# which is a check rather than a side effect.
RUN npm ci --omit=dev --no-audit --no-fund

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:26-bookworm-slim

ENV NODE_ENV=production

# Remove npm and its bundled tree. See the note at the top of this file.
# `corepack` goes too: it is a package-manager shim, equally unused at runtime.
RUN rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/corepack \
    && node --version

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Written to at runtime; owned by the unprivileged user so the service can create them.
RUN mkdir -p /data /certs && chown -R node:node /data /certs /app

USER node

EXPOSE 8443

# Volumes are declared in docker-compose.yml rather than here, so the compose file stays
# the single place that describes what persists.

CMD ["node", "src/server.ts"]
