# Graft — self-host image (P7.2).
#
# One image, two modes (see entrypoint.sh):
#   all-in-one (default): Postgres 18 + MinIO + `graft serve` in one container —
#     the "one container (dev)" claim. `docker run -p 3903:3903 graft` serves
#     the baked-in example project immediately; mount your own at /project.
#   serve: only the Graft runtime; DATABASE_URL + S3_* point at external
#     services (the split compose next to this file, or Neon/R2 by env).
#
# Build from the repo root (pre-1.0: packages are unpublished, so the image
# builds the workspace itself):
#   docker build -f deploy/docker/Dockerfile -t graft .

FROM node:24-bookworm AS builder
RUN npm install -g pnpm@11.9.0
WORKDIR /opt/graft
COPY . .
ENV CI=true
RUN pnpm install --frozen-lockfile
# Only the packages: the example project is served from source (jiti loads its
# config), so the Next app build has no business in this image.
RUN pnpm exec turbo run build --filter="./packages/*"

# MinIO server + client binaries come from the official images (registry
# pulls, not dl.min.io — some networks can't resolve it).
#
# Pinned by digest, not by tag. Both sat on `latest`, which MinIO moves on
# every release, so the same Dockerfile put a different storage server in the
# image from one build to the next, and a bad upstream release would reach a
# user's `docker run` with nothing in this repo having changed. Every action
# in the workflows is SHA-pinned for that reason, and a floating container tag
# is what OpenSSF Scorecard deducts for on Pinned-Dependencies. The digest is
# what gets pulled and the tag is only there to read, so moving to a newer
# release means resolving its digest from the registry, not editing the tag on
# its own. Both digests are multi-arch indexes, so arm64 still resolves.
FROM minio/minio:RELEASE.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e AS minio
FROM minio/mc:RELEASE.2025-08-13T08-35-41Z@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727 AS mc

# Runtime rides the official postgres image: its entrypoint owns initdb +
# role/db bootstrap, we add Node, MinIO, and the built workspace on top.
FROM postgres:18
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates openssl \
  && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*
COPY --from=minio /usr/bin/minio /usr/local/bin/minio
COPY --from=mc /usr/bin/mc /usr/local/bin/mc

COPY --from=builder /opt/graft /opt/graft
# The CR strip is not paranoia. On Windows, core.autocrlf beats this repo
# .gitattributes eol=lf, so entrypoint.sh can sit in the working tree with CRLF
# while git status reports it clean (git normalises on read). docker build
# copies the working tree, not git, so the image gets a shebang ending in CR
# and the container exits 127: env: 'bash\r': No such file or directory.
# The committed blob is LF and CI checks out on Linux, so this only bites a
# local build, which is exactly where a confusing failure costs most.
RUN printf '#!/bin/sh\nexec node /opt/graft/packages/cli/dist/index.js "$@"\n' > /usr/local/bin/graft \
  && sed -i 's/\r$//' /opt/graft/deploy/docker/entrypoint.sh \
  && chmod +x /usr/local/bin/graft /opt/graft/deploy/docker/entrypoint.sh

# Embedded-infra defaults; every one of these is overridable (and DATABASE_URL /
# S3_* pointing elsewhere is exactly how the managed swap works).
ENV POSTGRES_USER=graft \
  POSTGRES_PASSWORD=graft \
  POSTGRES_DB=graft \
  MINIO_ROOT_USER=graft \
  MINIO_ROOT_PASSWORD=graftsecret \
  S3_ENDPOINT=http://127.0.0.1:9000 \
  S3_ACCESS_KEY=graft \
  S3_SECRET_KEY=graftsecret \
  S3_BUCKET=graft-assets \
  PORT=3903 \
  HOST=0.0.0.0 \
  GRAFT_MODE=all-in-one

# 3903 = graft serve; 5432/9000/9001 = embedded Postgres/MinIO(+console), only
# meaningful in all-in-one mode and only if published.
EXPOSE 3903 5432 9000 9001

HEALTHCHECK --interval=10s --timeout=5s --start-period=90s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3903)+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/opt/graft/deploy/docker/entrypoint.sh"]
