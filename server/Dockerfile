# Node 24 runs TypeScript directly, so there is no build stage and no compiler here.
#
# The base image is Debian slim rather than Alpine. Both were tested under linux/arm64
# emulation and both resolve prebuilt native modules without a toolchain, so this is a
# preference rather than a necessity: musl's DNS resolver differs from glibc's, and this
# project makes DNS a prerequisite. See ADR-004.
FROM node:24-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app

# Dependencies first, so they stay cached when only source changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src

# Written to at runtime; owned by the unprivileged user so the service can create them.
RUN mkdir -p /data /certs && chown -R node:node /data /certs /app

# The image ships no shell tooling for the health check on purpose; node does it.
USER node

EXPOSE 8443

# Volumes are declared in docker-compose.yml rather than here, so the compose file stays
# the single place that describes what persists.

CMD ["node", "src/server.ts"]
