/**
 * Integration: deploy hooks are called after a publish, with their secret,
 * and each outcome is recorded on the hook (opt-in, live database).
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDb,
  createDeployHook,
  deleteDeployHook,
  listDeployHooks,
  runMigrations,
  type DbHandle,
} from "@usegraft/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deployHookUrlProblem, fireDeployHooks } from "./deploy-hooks";

try {
  const here = fileURLToPath(new URL(".", import.meta.url));
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const TIMEOUT = 30_000;

describe("deploy hook URLs", () => {
  it("takes https, and http only to this machine", () => {
    expect(deployHookUrlProblem("https://api.host.test/hooks/abc?token=1")).toBeNull();
    expect(deployHookUrlProblem("http://localhost:3000/api/revalidate")).toBeNull();
    expect(deployHookUrlProblem("http://hooks.test/abc")).toMatch(/https/);
    expect(deployHookUrlProblem("https://user:pw@hooks.test/abc")).toMatch(/user:password/);
    expect(deployHookUrlProblem("not a url")).toMatch(/isn't a URL/);
  });
});

describe.skipIf(!runIntegration)("deploy hooks (integration)", () => {
  let handle: DbHandle;
  const made: string[] = [];

  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL as string);
    handle = createDb(process.env.DATABASE_URL as string);
  }, TIMEOUT);

  afterAll(async () => {
    for (const id of made) await deleteDeployHook(handle.db, id);
    await handle.close();
  }, TIMEOUT);

  it("calls every hook, sends its secret, and records how each answered", async () => {
    const ok = await createDeployHook(handle.db, {
      name: "Rebuild",
      url: "https://hooks.test/build?token=t0p",
      secret: null,
    });
    const failing = await createDeployHook(handle.db, {
      name: "Revalidate",
      url: "https://site.test/api/revalidate",
      secret: "s3cret",
    });
    made.push(ok.id, failing.id);

    const seen: Array<{ url: string; auth: string | null; body: unknown }> = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      seen.push({ url, auth: headers.get("authorization"), body: JSON.parse(String(init?.body)) });
      return url.includes("revalidate")
        ? new Response("bad secret", { status: 401 })
        : new Response(null, { status: 204 });
    }) as typeof fetch;

    const results = await fireDeployHooks(
      handle.db,
      { event: "publish", branch: "main", paths: ["posts/a.mdx"] },
      { fetch: fakeFetch },
    );
    expect(results.map((r) => [r.name, r.status, r.error]).sort()).toEqual([
      ["Rebuild", 204, null],
      ["Revalidate", 401, "bad secret"],
    ]);
    expect(seen.find((s) => s.url.includes("revalidate"))?.auth).toBe("Bearer s3cret");
    expect(seen.find((s) => s.url.includes("build"))?.auth).toBeNull();
    expect(seen[0]?.body).toMatchObject({
      event: "publish",
      branch: "main",
      paths: ["posts/a.mdx"],
    });

    const stored = (await listDeployHooks(handle.db)).filter((h) => made.includes(h.id));
    expect(stored.map((h) => [h.name, h.lastStatus]).sort()).toEqual([
      ["Rebuild", 204],
      ["Revalidate", 401],
    ]);
  });

  it("records an unreachable hook without its query string, and never throws", async () => {
    const hook = await createDeployHook(handle.db, {
      name: "Down",
      url: "https://down.test/hook?token=secret-in-url",
      secret: null,
    });
    made.push(hook.id);
    const results = await fireDeployHooks(
      handle.db,
      { event: "test", branch: "main", paths: [] },
      {
        // As Node's fetch fails: a bare "fetch failed" with the reason as its cause.
        fetch: (async (input: string | URL | Request) => {
          throw new TypeError("fetch failed", {
            cause: new Error(`connect ECONNREFUSED ${String(input)}`),
          });
        }) as typeof fetch,
      },
    );
    const down = results.find((r) => r.id === hook.id);
    expect(down?.status).toBeNull();
    expect(down?.error).toContain("ECONNREFUSED https://down.test/hook");
    expect(down?.error).not.toContain("secret-in-url");
  });
});
