# Node 24 LTS pinned on a specific digest for provenance and CVE-scan reproducibility.
# EOL: 2028-04-30. Pinned to 24 LTS because:
#   - Long-term support guarantees security patches through v1 lifetime.
#   - ws 8.21.0 and @types/node ^24 are validated against this major.
#   - Future upgrade to 26 LTS (or later) should be a deliberate, story-tracked decision.
# Digest must be refreshed on each intentional base-image update (see deploy runbook).
FROM node:24-slim@sha256:placeholder

# Non-root runtime user (PUID:PGID = 99:100 by default; override at Compose level)
ARG PUID=99
ARG PGID=100
RUN groupadd --gid ${PGID} puller-group || true \
    && useradd --uid ${PUID} --gid ${PGID} --no-create-home --shell /usr/sbin/nologin puller-user

WORKDIR /app

# Install production deps with frozen lockfile; dev deps excluded in production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

USER puller-user

# umask 002 ensures group-writable files so the KB sync user (same PGID) can manage them.
# No lock file or metadata file is created outside the Target directory.
CMD ["sh", "-c", "umask 002 && node src/index.js"]
