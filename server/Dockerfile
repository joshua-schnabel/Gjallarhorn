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
FROM node:24-bookworm-slim AS deps

WORKDIR /app

# Dependencies first, so the layer stays cached when only source changes.
COPY package.json package-lock.json ./

# `npm ci` and not `npm install`: it fails when the manifest and the lock file disagree,
# which is a check rather than a side effect.
#
# `--ignore-scripts` for two reasons, and both matter.
#
# Correctness: better-sqlite3 ships prebuilt binaries for every platform this project
# targets, including linux-x64, linux-arm64 and both musl variants. It also ships a
# binding.gyp, and npm's default install behaviour for a package with one is to run
# `node-gyp rebuild` regardless. That needs Python and a C toolchain, which this image
# deliberately does not have — so the build failed while a perfectly good prebuilt binary
# sat unused in the package. Verified: with scripts ignored, the prebuild loads and runs.
#
# Supply chain: an install script is arbitrary code from the dependency tree, executed at
# image build time. Not running any is the stronger default, and the integration test is
# the guard — the service opens the database on startup, so a native module that did not
# load fails the pipeline rather than production.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim

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
# The schema travels with the code that applies it. Without this the service starts and
# then fails on a missing migrations directory - which is how the integration test found
# it, rather than a deployment doing so.
COPY migrations ./migrations

# Written to at runtime; owned by the unprivileged user so the service can create them.
RUN mkdir -p /data /certs && chown -R node:node /data /certs /app

USER node

EXPOSE 8443

# Volumes are declared in docker-compose.yml rather than here, so the compose file stays
# the single place that describes what persists.

CMD ["node", "src/server.ts"]
