# Deploying Graft (P7.3)

Two topologies, decided in
[`docs/design-notes/packaging.md`](../docs/design-notes/packaging.md) — pick by
where your compute runs:

| Adapter                 | Topology  | Runs                                                                                |
| ----------------------- | --------- | ----------------------------------------------------------------------------------- |
| [Railway](./railway.md) | container | the `deploy/docker` image (`GRAFT_MODE=serve`) + managed Postgres/R2                |
| [Fly.io](./fly.md)      | container | the same image on Fly Machines; Tigris or R2 for assets                             |
| [VPS](./vps.md)         | container | the split compose (`db`/`storage`/`graft`) behind a reverse proxy                   |
| [Vercel](./vercel.md)   | embedded  | your Next app mounts the handlers (no container — Vercel compute is request-scoped) |

Both topologies serve identical bytes: `graft serve` and an app route mount the
same stateless `Request → Response` handlers.

## The credential recipe (every adapter repeats this)

Give the deployment a runtime credential that can execute everything mounted
but can **never approve its own destructive operations** (see
[`approval-hardening.md`](../docs/design-notes/approval-hardening.md)):

```sh
# As the operator (owner DATABASE_URL — psql, Neon console, etc.):
CREATE ROLE graft_runtime LOGIN PASSWORD '…';

# From your project, still as the operator:
graft harden graft_runtime

# Deploy with the runtime role's connection URL as DATABASE_URL.
# Keep the operator URL local/CI-only: graft compile / migrate / approve.
```

The container automates this. In all-in-one it is the default: boot creates the
role, hardens it, and serves under it, generating a password when you supply
none. In `GRAFT_MODE=serve` the database is yours rather than the container's,
so set `GRAFT_HARDEN=1` or `GRAFT_RUNTIME_PASSWORD` to opt in. `GRAFT_HARDEN=0`
turns it off anywhere.

One thing to know: `graft harden` grants Graft's own tables. Tables your app
adds, such as an embedded auth provider's, need granting separately.

## Who runs what

| Task                                                                         | Credential         | Where                                                    |
| ---------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------- |
| `graft compile` / `graft migrate --apply` / `graft merge`                    | operator           | CI or your machine (the container also compiles at boot) |
| `graft approve` / `graft deny`                                               | operator (a human) | your machine                                             |
| serve functions, MCP (incl. content writes), reads, approval request/consume | runtime            | the deployment                                           |

## Pre-1.0 note

`@usegraft/*` is unpublished, so container deploys build from this workspace: your
project either mounts at `/project`, or bakes in via a derived image —

```dockerfile
FROM graft
COPY my-site /project
```

(the entrypoint links `/project/node_modules` to the image's packages at boot).
When packages publish, this collapses to `npm i @usegraft/cli` + your project.
