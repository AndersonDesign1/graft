# Graft on a VPS (container topology)

A single box running Docker: the split compose from `deploy/docker/` plus a
reverse proxy for TLS. This is the fully self-contained deployment — no
managed services at all.

## 1. Bring up the stack

```sh
git clone <your-fork> graft && cd graft/deploy/docker
# Edit compose.yml: set real passwords, GRAFT_DEV_TOKEN (or issuers), and
# GRAFT_RUNTIME_PASSWORD for the hardened runtime credential; mount your
# project under the graft service's volumes (…:/project).
docker compose up -d --build
curl http://127.0.0.1:3903/healthz
```

Postgres and MinIO data persist in the `graft_pg` / `graft_minio` volumes;
the graft service recompiles content at every boot (hash-diff — unchanged
trees are a no-op).

## 2. TLS / reverse proxy

Expose only the proxy; keep 3903/5432/9000 off the public interface. Caddy is
the two-liner:

```
# Caddyfile
graft.example.com {
    reverse_proxy 127.0.0.1:3903
}
```

(nginx equivalent: `proxy_pass http://127.0.0.1:3903;` — nothing Graft-specific;
the handlers only need the request as-is.)

## 3. Harden

Split compose runs `GRAFT_MODE=serve`, where the database is yours and
hardening is opt-in. Set `GRAFT_HARDEN=1` in compose.yml (or supply
`GRAFT_RUNTIME_PASSWORD` to choose the secret yourself) and boot does the rest:
creates `graft_runtime`, applies `graft harden`, serves under it. The single
all-in-one container hardens by default, because there the database is its own.

Deciding approvals then requires the operator credential, from the box:

```sh
docker compose exec graft graft approvals
docker compose exec graft env DATABASE_URL=postgres://graft:<operator-pw>@db:5432/graft graft approve <id>
```

(Or run `graft approve` from any machine that can reach the db with the
operator URL. The point of the split: the _serving_ credential physically
cannot do this — `UPDATE approvals` is permission-denied at the Postgres
layer.)

## 4. Operations

- **Content deploys:** `git pull` + `docker compose up -d --build` (boot
  recompiles), or run `graft compile` against the db from CI with the
  operator URL — no restart needed, reads are live.
- **Backups:** `docker compose exec db pg_dump -U graft graft` + a MinIO
  volume snapshot. Authored content needs no backup — git is authoritative;
  the index rebuilds from a compile.
- **Upgrades:** pull the new workspace, `docker compose up -d --build`;
  schema migrations run at boot.
