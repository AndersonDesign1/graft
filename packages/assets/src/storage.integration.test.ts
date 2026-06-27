import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createStorage } from "./storage";

// Best-effort load of repo-root .env so this runs locally; skipped without creds (e.g. CI).
try {
  const here = fileURLToPath(new URL(".", import.meta.url));
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present — the suite below will skip */
}

const hasR2 = Boolean(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY);
// Opt-in: network integration tests are skipped by default (and in CI) so `pnpm test`
// stays fast and deterministic. Run them explicitly with RUN_INTEGRATION=1.
const runIntegration = process.env.RUN_INTEGRATION === "1" && hasR2;

describe.skipIf(!runIntegration)("R2 storage (integration)", () => {
  it("put -> exists -> get -> delete round-trips against the bucket", async () => {
    const storage = createStorage();
    const key = `__graft_smoke__/${Date.now()}.txt`;
    const payload = "graft r2 ok";

    await storage.put(key, payload, "text/plain");
    expect(await storage.exists(key)).toBe(true);

    const roundTrip = new TextDecoder().decode(await storage.get(key));
    expect(roundTrip).toBe(payload);

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  }, 30_000);
});
