import { generateKeyPairSync, createVerify } from "node:crypto";
import { GraftError } from "@usegraft/contracts";
import { describe, expect, it } from "vitest";
import { gitBlobSha } from "../blob";
import { appAuth, appJwt, tokenAuth } from "./auth";
import { deployedShaFrom, githubStoreFromEnv } from "./env";
import { createGitHubFake, type GitHubFake } from "./fake";
import { actorKey, GitHubStore, normalisePath, type GitHubStoreOptions } from "./store";
import { trimChar, withoutTrailingSlashes } from "../trim";

const ana = { id: "ana", name: "Ana Lima", email: "ana@shop.test" };
const ben = { id: "ben", name: "Ben", email: "ben@shop.test" };

const shirt = "---\ntitle: Shirt\n---\nA shirt.\n";
const hat = "---\ntitle: Hat\n---\nA hat.\n";

function setup(
  files: Record<string, string> = {
    "content/products/shirt.mdx": shirt,
    "content/products/hat.mdx": hat,
    "README.md": "# shop\n",
  },
  options: Partial<GitHubStoreOptions> = {},
): { fake: GitHubFake; store: GitHubStore } {
  const fake = createGitHubFake({ repo: "acme/shop", files });
  const store = new GitHubStore({
    repo: "acme/shop",
    auth: tokenAuth(fake.token),
    apiUrl: fake.apiUrl,
    fetch: fake.fetch,
    ...options,
  });
  return { fake, store };
}

async function caught(promise: Promise<unknown>): Promise<GraftError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GraftError) return error;
    throw error;
  }
  throw new Error("expected a GraftError");
}

describe("GitHubStore: drafts", () => {
  it("reads the published bytes with their blob SHA as the version", async () => {
    const { store } = setup();
    const file = await store.read("products/shirt.mdx", ana);
    expect(file).toEqual({ raw: shirt, version: gitBlobSha(shirt) });
    expect(await store.read("products/none.mdx", ana)).toBeNull();
  });

  it("saves to the editor's own branch and leaves production alone", async () => {
    const { fake, store } = setup();
    const edited = shirt.replace("A shirt.", "A better shirt.");
    const base = (await store.read("products/shirt.mdx", ana))?.version;

    await store.write("products/shirt.mdx", edited, { actor: ana, baseVersion: base });

    expect(fake.files()["content/products/shirt.mdx"]).toBe(shirt);
    expect(fake.files("graft-studio/drafts/ana")["content/products/shirt.mdx"]).toBe(edited);
    expect((await store.read("products/shirt.mdx", ana))?.raw).toBe(edited);
    // Another editor still sees what is published.
    expect((await store.read("products/shirt.mdx", ben))?.raw).toBe(shirt);
    expect(await store.drafts.changes(ana)).toEqual([
      {
        path: "products/shirt.mdx",
        kind: "modified",
        version: gitBlobSha(edited),
        conflict: false,
      },
    ]);
    // Author is the editor, not the credential.
    expect(fake.log("graft-studio/drafts/ana")[0]?.author).toEqual({
      name: "Ana Lima",
      email: "ana@shop.test",
    });
  });

  it("reports added and deleted documents in editor terms", async () => {
    const { store } = setup();
    await store.write("products/sock.mdx", "---\ntitle: Sock\n---\n", {
      actor: ana,
      baseVersion: null,
    });
    await store.write("products/hat.mdx", null, { actor: ana });
    const changes = await store.drafts.changes(ana);
    expect(changes.map(({ path, kind }) => ({ path, kind }))).toEqual([
      { path: "products/hat.mdx", kind: "deleted" },
      { path: "products/sock.mdx", kind: "added" },
    ]);
    expect(await store.read("products/hat.mdx", ana)).toBeNull();
  });

  it("refuses a save made from a stale read", async () => {
    const { store } = setup();
    const opened = (await store.read("products/shirt.mdx", ana))?.version;
    await store.write("products/shirt.mdx", `${shirt}one\n`, { actor: ana, baseVersion: opened });
    const error = await caught(
      store.write("products/shirt.mdx", `${shirt}two\n`, { actor: ana, baseVersion: opened }),
    );
    expect(error.code).toBe("CONTENT_CONFLICT");
    expect((await store.read("products/shirt.mdx", ana))?.raw).toBe(`${shirt}one\n`);
  });

  it("refuses to create over an existing document", async () => {
    const { store } = setup();
    const error = await caught(
      store.write("products/shirt.mdx", hat, { actor: ana, baseVersion: null }),
    );
    expect(error.code).toBe("CONTENT_CONFLICT");
    expect(error.message).toContain("already exists");
  });

  it("keeps both of two simultaneous saves", async () => {
    const { fake, store } = setup();
    await store.write("products/shirt.mdx", `${shirt}x\n`, { actor: ana });
    await Promise.all([
      store.write("products/shirt.mdx", `${shirt}tab one\n`, { actor: ana }),
      store.write("products/hat.mdx", `${hat}tab two\n`, { actor: ana }),
    ]);
    const draft = fake.files("graft-studio/drafts/ana");
    expect(draft["content/products/shirt.mdx"]).toBe(`${shirt}tab one\n`);
    expect(draft["content/products/hat.mdx"]).toBe(`${hat}tab two\n`);
  });

  it("discards back to the published version and removes an empty draft", async () => {
    const { fake, store } = setup();
    await store.write("products/shirt.mdx", `${shirt}x\n`, { actor: ana });
    await store.write("products/hat.mdx", `${hat}x\n`, { actor: ana });
    await store.drafts.discard(ana, ["products/shirt.mdx"]);
    expect((await store.drafts.changes(ana)).map((c) => c.path)).toEqual(["products/hat.mdx"]);
    expect((await store.read("products/shirt.mdx", ana))?.raw).toBe(shirt);
    await store.drafts.discard(ana, ["products/hat.mdx"]);
    expect(await store.drafts.changes(ana)).toEqual([]);
    expect(fake.branches()).toEqual(["main"]);
  });

  it("rejects paths that leave the content directory", () => {
    expect(() => normalisePath("../.github/workflows/x.yml")).toThrow(GraftError);
    expect(() => normalisePath("products/../../x")).toThrow(GraftError);
    expect(normalisePath("/products/a.mdx")).toBe("products/a.mdx");
  });

  it("gives every actor its own branch key", () => {
    expect(actorKey({ id: "ana" })).toBe("ana");
    expect(actorKey({ id: "writer-bot" })).toBe("writer-bot");
    expect(actorKey({ id: "Ana.Lima@Shop.test" })).toMatch(/^ana-lima-shop-test-[0-9a-f]{10}$/);
    expect(actorKey({ id: "a+b@x.com" })).not.toBe(actorKey({ id: "a-b@x.com" }));
    expect(actorKey({ id: "x".repeat(200) })).toMatch(/^x{37}-[0-9a-f]{10}$/);
    expect(actorKey({ id: "@@@" })).toMatch(/^editor-[0-9a-f]{10}$/);
  });

  it("trims configured paths and URLs in linear time", () => {
    expect(trimChar("//content//", "/", "both")).toBe("content");
    expect(withoutTrailingSlashes("https://api.github.com///")).toBe("https://api.github.com");
    const slashes = "/".repeat(100_000);
    const started = performance.now();
    expect(trimChar(`${slashes}a${slashes}x`, "/", "both")).toBe(`a${slashes}x`);
    expect(trimChar(`x${slashes}a${slashes}`, "/")).toBe(`x${slashes}a`);
    expect(withoutTrailingSlashes(`https://api.github.com${slashes}`)).toBe(
      "https://api.github.com",
    );
    expect(trimChar("🚀🚀a🚀", "🚀", "both")).toBe("a");
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("GitHubStore: publishing", () => {
  it("publishes the selected documents as one commit on production", async () => {
    const { fake, store } = setup();
    await store.write("products/shirt.mdx", `${shirt}new\n`, { actor: ana });
    await store.write("products/hat.mdx", `${hat}new\n`, { actor: ana });
    const before = fake.log().length;

    const result = await store.drafts.publish({
      actor: ana,
      paths: ["products/shirt.mdx"],
      message: "Spring copy",
    });

    expect(result.mode).toBe("direct");
    expect(result.published).toEqual(["products/shirt.mdx"]);
    expect(result.commit?.url).toContain("/acme/shop/commit/");
    const log = fake.log();
    expect(log.length).toBe(before + 1);
    expect(log[0]).toMatchObject({
      message: "Spring copy",
      author: { name: "Ana Lima", email: "ana@shop.test" },
    });
    expect(fake.files()["content/products/shirt.mdx"]).toBe(`${shirt}new\n`);
    expect(fake.files()["content/products/hat.mdx"]).toBe(hat);
    expect((await store.drafts.changes(ana)).map((c) => c.path)).toEqual(["products/hat.mdx"]);
  });

  it("deletes the draft branch once everything is published", async () => {
    const { fake, store } = setup();
    await store.write("products/sock.mdx", "---\ntitle: Sock\n---\n", { actor: ana });
    await store.write("products/hat.mdx", null, { actor: ana });
    await store.drafts.publish({ actor: ana, paths: ["products/sock.mdx", "products/hat.mdx"] });
    expect(fake.branches()).toEqual(["main"]);
    expect(Object.keys(fake.files()).sort()).toEqual([
      "README.md",
      "content/products/shirt.mdx",
      "content/products/sock.mdx",
    ]);
    expect(fake.log()[0]?.message).toBe("Publish products/sock, products/hat");
  });

  it("never reverts what production gained after the draft began", async () => {
    const { fake, store } = setup();
    await store.write("products/shirt.mdx", `${shirt}mine\n`, { actor: ana });
    fake.push("main", { "content/products/hat.mdx": `${hat}from a developer\n` });
    await store.drafts.publish({ actor: ana, paths: ["products/shirt.mdx"] });
    expect(fake.files()["content/products/hat.mdx"]).toBe(`${hat}from a developer\n`);
    expect(fake.files()["content/products/shirt.mdx"]).toBe(`${shirt}mine\n`);
  });

  it("brings production's unrelated changes into the draft on the next save", async () => {
    const { fake, store } = setup();
    await store.write("products/shirt.mdx", `${shirt}1\n`, { actor: ana });
    fake.push("main", { "content/products/hat.mdx": `${hat}dev\n` });
    await store.write("products/shirt.mdx", `${shirt}2\n`, { actor: ana });
    expect(fake.files("graft-studio/drafts/ana")["content/products/hat.mdx"]).toBe(`${hat}dev\n`);
    expect((await store.drafts.changes(ana)).map((c) => c.path)).toEqual(["products/shirt.mdx"]);
    expect((await store.read("products/hat.mdx", ana))?.raw).toBe(`${hat}dev\n`);
  });

  it("refuses to publish over a newer published version until someone chooses", async () => {
    const { fake, store } = setup();
    await store.write("products/shirt.mdx", `${shirt}mine\n`, { actor: ana });
    fake.push("main", { "content/products/shirt.mdx": `${shirt}theirs\n` });

    expect((await store.drafts.changes(ana))[0]?.conflict).toBe(true);
    const error = await caught(store.drafts.publish({ actor: ana, paths: ["products/shirt.mdx"] }));
    expect(error.code).toBe("CONTENT_CONFLICT");
    expect(error.details).toEqual({ conflicts: [{ path: "products/shirt.mdx" }] });
    expect(fake.files()["content/products/shirt.mdx"]).toBe(`${shirt}theirs\n`);

    // A save while conflicted must not quietly merge production in.
    await store.write("products/shirt.mdx", `${shirt}mine again\n`, { actor: ana });
    expect((await store.drafts.changes(ana))[0]?.conflict).toBe(true);

    await store.drafts.publish({
      actor: ana,
      paths: ["products/shirt.mdx"],
      resolve: { "products/shirt.mdx": "mine" },
    });
    expect(fake.files()["content/products/shirt.mdx"]).toBe(`${shirt}mine again\n`);
  });

  it("can keep the published version and drop the draft instead", async () => {
    const { fake, store } = setup();
    await store.write("products/shirt.mdx", `${shirt}mine\n`, { actor: ana });
    await store.write("products/hat.mdx", `${hat}mine\n`, { actor: ana });
    fake.push("main", { "content/products/shirt.mdx": `${shirt}theirs\n` });
    const result = await store.drafts.publish({
      actor: ana,
      paths: ["products/shirt.mdx"],
      resolve: { "products/shirt.mdx": "theirs" },
    });
    expect(result.commit).toBeNull();
    expect(result.tookTheirs).toEqual(["products/shirt.mdx"]);
    expect((await store.read("products/shirt.mdx", ana))?.raw).toBe(`${shirt}theirs\n`);
    expect((await store.drafts.changes(ana)).map((c) => c.path)).toEqual(["products/hat.mdx"]);
  });

  it("retries when production moves during the publish", async () => {
    const { fake, store } = setup();
    await store.write("products/shirt.mdx", `${shirt}mine\n`, { actor: ana });
    // A push lands between reading main and moving it, so the first
    // fast-forward is refused. The retry must build on that push, not over it.
    fake.failNext("PATCH", "/repos/acme/shop/git/refs/heads/main", 422, 1, () => {
      fake.push("main", { "README.md": "# shop, renamed\n" });
    });
    await store.drafts.publish({ actor: ana, paths: ["products/shirt.mdx"] });
    expect(fake.files()["content/products/shirt.mdx"]).toBe(`${shirt}mine\n`);
    expect(fake.files()["README.md"]).toBe("# shop, renamed\n");
  });

  it("has the stand-in GitHub refuse a review that conflicts with production", async () => {
    const { fake, store } = setup(undefined, { publishMode: "review" });
    await store.write("products/hat.mdx", `${hat}reviewed\n`, { actor: ana });
    await store.drafts.publish({ actor: ana, paths: ["products/hat.mdx"] });
    fake.push("main", { "content/products/hat.mdx": `${hat}hotfix\n` });
    expect(() => fake.mergePull(1)).toThrow(/conflicts/);
    expect(fake.files()["content/products/hat.mdx"]).toBe(`${hat}hotfix\n`);
  });

  it("opens a pull request in review mode and keeps production untouched", async () => {
    const { fake, store } = setup(undefined, { publishMode: "review" });
    await store.write("products/shirt.mdx", `${shirt}reviewed\n`, { actor: ana });
    await store.write("products/hat.mdx", `${hat}later\n`, { actor: ana });

    const result = await store.drafts.publish({
      actor: ana,
      paths: ["products/shirt.mdx"],
      message: "New shirt copy",
    });

    expect(result.mode).toBe("review");
    expect(result.review).toMatchObject({ number: 1, title: "New shirt copy" });
    expect(fake.files()["content/products/shirt.mdx"]).toBe(shirt);
    const [pull] = fake.pulls();
    expect(pull?.head).toMatch(/^graft-studio\/review\/ana-/);
    expect(fake.files(pull?.head)["content/products/shirt.mdx"]).toBe(`${shirt}reviewed\n`);
    // Submitted documents leave the draft; the rest stay.
    expect((await store.drafts.changes(ana)).map((c) => c.path)).toEqual(["products/hat.mdx"]);
    expect((await store.drafts.reviews(ana)).map((r) => r.number)).toEqual([1]);
    expect(await store.drafts.reviews(ben)).toEqual([]);

    fake.mergePull(1);
    expect(fake.files()["content/products/shirt.mdx"]).toBe(`${shirt}reviewed\n`);
    expect(await store.drafts.reviews(ana)).toEqual([]);
    expect((await store.drafts.changes(ana)).map((c) => c.path)).toEqual(["products/hat.mdx"]);
    expect((await store.read("products/shirt.mdx", ana))?.raw).toBe(`${shirt}reviewed\n`);
  });

  it("refuses to publish a path with no changes", async () => {
    const { store } = setup();
    const error = await caught(store.drafts.publish({ actor: ana, paths: ["products/shirt.mdx"] }));
    expect(error.code).toBe("INPUT_VALIDATION_FAILED");
  });
});

describe("GitHubStore: layout and listing", () => {
  it("finds content below a nested path, or at the repository root", async () => {
    const nested = setup({ "apps/shop/content/a.mdx": "a" }, { contentPath: "apps/shop/content" });
    expect((await nested.store.read("a.mdx"))?.raw).toBe("a");
    await nested.store.write("b.mdx", "b", { actor: ana });
    expect(nested.fake.files("graft-studio/drafts/ana")["apps/shop/content/b.mdx"]).toBe("b");

    const root = setup({ "a.mdx": "a" }, { contentPath: "" });
    expect((await root.store.read("a.mdx"))?.raw).toBe("a");
  });

  it("overlays what changed since the deployed commit", async () => {
    const fake = createGitHubFake({ repo: "acme/shop", files: { "content/a.mdx": "a" } });
    const deployed = fake.head() as string;
    fake.push("main", { "content/b.mdx": "b", "content/a.mdx": null });
    const store = new GitHubStore({
      repo: "acme/shop",
      auth: tokenAuth(fake.token),
      apiUrl: fake.apiUrl,
      fetch: fake.fetch,
      deployedSha: deployed,
    });
    await store.write("c.mdx", "c", { actor: ana });
    const overlay = await store.overlay(ana);
    expect([...overlay.keys()].sort()).toEqual(["a.mdx", "b.mdx", "c.mdx"]);
    expect(overlay.get("a.mdx")).toBeNull();
    expect(overlay.get("c.mdx")?.raw).toBe("c");
    // Another editor's overlay has production but not Ana's draft.
    expect([...(await store.overlay(ben)).keys()].sort()).toEqual(["a.mdx", "b.mdx"]);
  });

  it("explains a credential GitHub rejects", async () => {
    const fake = createGitHubFake({ repo: "acme/shop" });
    const store = new GitHubStore({
      repo: "acme/shop",
      auth: tokenAuth("wrong"),
      apiUrl: fake.apiUrl,
      fetch: fake.fetch,
    });
    const error = await caught(store.read("a.mdx"));
    expect(error.code).toBe("REMOTE_STORE_FAILED");
    expect(error.details).toMatchObject({ status: 401 });
    expect(error.fix).toContain("GRAFT_GITHUB_TOKEN");
  });

  it("reports an unreachable GitHub as a store failure, not a crash", async () => {
    const store = new GitHubStore({
      repo: "acme/shop",
      auth: tokenAuth("t"),
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const error = await caught(store.read("a.mdx"));
    expect(error.code).toBe("REMOTE_STORE_FAILED");
    expect(error.message).toContain("fetch failed");
  });

  it("explains a missing production branch", async () => {
    const { store } = setup(undefined, { branch: "production" });
    const error = await caught(store.read("products/shirt.mdx"));
    expect(error.code).toBe("REMOTE_STORE_FAILED");
    expect(error.fix).toContain("GRAFT_GITHUB_BRANCH");
  });
});

describe("GitHub App credentials", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

  it("signs an RS256 JWT GitHub can verify", () => {
    const jwt = appJwt("123", pem.replace(/\n/g, "\\n"), Date.parse("2026-10-01T00:00:00Z"));
    const [header, payload, signature] = jwt.split(".") as [string, string, string];
    const verify = createVerify("RSA-SHA256");
    verify.update(`${header}.${payload}`);
    expect(verify.verify(publicKey, signature, "base64url")).toBe(true);
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
      iat: Date.parse("2026-10-01T00:00:00Z") / 1000 - 60,
      exp: Date.parse("2026-10-01T00:00:00Z") / 1000 + 540,
      iss: "123",
    });
  });

  it("finds the installation, mints a token once, and reuses it", async () => {
    const calls: string[] = [];
    let now = Date.parse("2026-10-01T00:00:00Z");
    const auth = appAuth({
      appId: "123",
      privateKey: pem,
      repo: "acme/shop",
      apiUrl: "https://github.test/api",
      now: () => now,
      fetch: (async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/repos/acme/shop/installation")) {
          return Response.json({ id: 77 });
        }
        return Response.json({
          token: `tok-${calls.length}`,
          expires_at: new Date(now + 3_600_000).toISOString(),
        });
      }) as typeof fetch,
    });
    const [first, second] = await Promise.all([auth.token(), auth.token()]);
    expect(first).toBe(second);
    expect(calls).toEqual([
      "https://github.test/api/repos/acme/shop/installation",
      "https://github.test/api/app/installations/77/access_tokens",
    ]);
    now += 56 * 60_000; // within five minutes of expiry
    expect(await auth.token()).not.toBe(first);
  });

  it("refuses a malformed key with a fix", () => {
    expect(() => appJwt("1", "not a key", Date.now())).toThrow(/private key/);
  });
});

describe("githubStoreFromEnv", () => {
  it("is off without a repository", () => {
    expect(githubStoreFromEnv({ contentDir: "/srv/site/content", env: {} })).toBeUndefined();
  });

  it("needs a credential once a repository is named", () => {
    expect(() =>
      githubStoreFromEnv({ contentDir: "/srv/content", env: { GRAFT_GITHUB_REPO: "a/b" } }),
    ).toThrow(/no credential/);
  });

  it("reads branch, publish mode and the content path", () => {
    const store = githubStoreFromEnv({
      contentDir: "/srv/site/apps/web/content",
      projectRoot: "/srv/site",
      env: {
        GRAFT_GITHUB_REPO: "acme/shop",
        GRAFT_GITHUB_TOKEN: "t",
        GRAFT_GITHUB_BRANCH: "production",
        GRAFT_STUDIO_PUBLISH: "pull-request",
      },
    });
    expect(store?.info()).toEqual({
      kind: "github",
      repository: "acme/shop",
      branch: "production",
      publishMode: "review",
      url: "https://github.com/acme/shop",
    });
  });

  it("uses the repository root when the content directory is the project root", async () => {
    const fake = createGitHubFake({ repo: "acme/shop", files: { "pages/home.mdx": hat } });
    const store = githubStoreFromEnv({
      contentDir: "/srv/site",
      projectRoot: "/srv/site",
      fetch: fake.fetch,
      env: {
        GRAFT_GITHUB_REPO: "acme/shop",
        GRAFT_GITHUB_TOKEN: fake.token,
        GRAFT_GITHUB_API_URL: fake.apiUrl,
      },
    });
    expect(await store?.read("pages/home.mdx", ana)).toMatchObject({ raw: hat });
  });

  it("rejects an unknown publish mode", () => {
    expect(() =>
      githubStoreFromEnv({
        contentDir: "/c",
        env: { GRAFT_GITHUB_REPO: "a/b", GRAFT_GITHUB_TOKEN: "t", GRAFT_STUDIO_PUBLISH: "yolo" },
      }),
    ).toThrow(/GRAFT_STUDIO_PUBLISH/);
  });

  it("takes the deployed commit from the host", () => {
    const sha = "a".repeat(40);
    expect(deployedShaFrom({ VERCEL_GIT_COMMIT_SHA: sha })).toBe(sha);
    expect(deployedShaFrom({ GITHUB_SHA: "short" })).toBeUndefined();
  });
});
