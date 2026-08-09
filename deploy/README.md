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

The container automates this: set `GRAFT_RUNTIME_PASSWORD` and boot creates,
hardens, and serves under the role. Two things to know: the hardened
credential cannot project content, so MCP `write_content`/`delete_content`
need the operator credential — hardened deployments are functions/reads-first;
and `graft harden` grants Graft's tables only — tables your app adds (e.g. an
embedded auth provider's) get granted separately.

## Who runs what

| Task                                                      | Credential         | Where                                                    |
| --------------------------------------------------------- | ------------------ | -------------------------------------------------------- |
| `graft compile` / `graft migrate --apply` / `graft merge` | operator           | CI or your machine (the container also compiles at boot) |
| `graft approve` / `graft deny`                            | operator (a human) | your machine                                             |
| serve functions, MCP, reads, approval request/consume     | runtime            | the deployment                                           |

## Pre-1.0 note

`@usegraft/*` is unpublished, so container deploys build from this workspace: your
project either mounts at `/project`, or bakes in via a derived image —

```dockerfile
FROM graft
COPY my-site /project
```

(the entrypoint links `/project/node_modules` to the image's packages at boot).
When packages publish, this collapses to `npm i @usegraft/cli` + your project.
