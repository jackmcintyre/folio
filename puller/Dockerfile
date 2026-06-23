# Folio Puller — Dockerfile
#
# Runtime pin rationale (AR-1, AD-20):
#   Base image: node:24-alpine
#     Pins Node.js 24 LTS (EOL 2028-04-30).  Node 24 LTS is the designated runtime
#     for the Puller; the LTS guarantee means security patches land for the full
#     product lifecycle without a major-version bump.  Alpine keeps the image small
#     and reduces the CVE surface.
#
#     The digest must be pinned before the first production deploy (AD-20):
#       docker pull node:24-alpine && docker inspect --format='{{index .RepoDigests 0}}' node:24-alpine
#     Replace `:node:24-alpine` with `node@sha256:<digest>` and commit.
#
# Non-root execution (AD-3):
#   Runs as uid/gid 99:100 (default PUID:PGID — confirm against the actual share
#   owner before deploy, §10.1).  Creates no lock/style file that the KB sync
#   container cannot delete.

FROM node:24-alpine

# Set working directory
WORKDIR /app

# Copy dependency manifests first (layer-cache friendly)
COPY package.json package-lock.json ./

# Frozen install — mirrors the CI gate (AC2)
RUN npm ci --ignore-scripts

# Copy compiled output
COPY dist/ ./dist/

# Non-root user: uid 99, gid 100 (AD-3, §10.1)
RUN addgroup -g 100 folio 2>/dev/null || true && \
    adduser -u 99 -G folio -s /bin/sh -D folio && \
    chown -R folio:folio /app
USER folio

# The Target directory is mounted at runtime; the container writes nothing else.
VOLUME ["/data"]

CMD ["node", "--enable-source-maps", "dist/index.js"]
