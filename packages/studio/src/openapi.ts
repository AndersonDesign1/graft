/**
 * OpenAPI 3 document for the Studio surface.
 * Source of truth for humans: ../openapi.yaml — keep this export in sync.
 */
export const STUDIO_OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Graft Studio API",
    version: "0.2.0",
    description:
      "Opt-in Studio HTTP surface. UI is a client of this API. Every operation is also available via MCP and CLI (headless parity).",
  },
  servers: [{ url: "/" }],
  paths: {
    "/api/studio/v1/openapi.json": {
      get: {
        operationId: "getOpenApi",
        summary: "OpenAPI document",
        responses: { "200": { description: "OpenAPI 3 document" } },
      },
    },
    "/api/studio/v1/tree": {
      get: {
        operationId: "getContentTree",
        summary: "Content tree (disk merged with the compiled index)",
        description:
          'Filesystem-first: every on-disk document appears immediately, each tagged synced | drifted | unindexed | orphaned by comparing its contentHash against content_index. db-authoritative collections are returned with authority:"db" and no documents.',
        parameters: [{ name: "branch", in: "query", schema: { type: "string" } }],
        responses: { "200": { description: "Collections → documents + drift summary" } },
      },
    },
    "/api/studio/v1/collections": {
      get: {
        operationId: "listCollectionSchemas",
        summary: "Collection schemas (same shape as MCP describe_schema)",
        responses: { "200": { description: "Collections → fields" } },
      },
    },
    "/api/studio/v1/asset-url": {
      get: {
        operationId: "resolveAssetUrl",
        summary: "Loadable URL for an asset key (public URL, else presigned GET)",
        description:
          "Returns `{ key, url }`. `url` is null with a `reason` when no asset store is configured — a static-tier project has no credentials by design, so an unresolved key is a normal state, not an error.",
        parameters: [{ name: "key", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Resolved URL, or null with a reason" } },
      },
    },
    "/api/studio/v1/compile": {
      post: {
        operationId: "compileBranch",
        summary: "Recompile a branch's content index (same as graft compile)",
        parameters: [{ name: "branch", in: "query", schema: { type: "string" } }],
        responses: { "200": { description: "Change counts + git SHA" } },
      },
    },
    "/api/studio/v1/document": {
      get: {
        operationId: "getDocument",
        summary: "Read one MDX document (file truth)",
        parameters: [
          { name: "collection", in: "query", required: true, schema: { type: "string" } },
          { name: "slug", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Document data + body + raw" } },
      },
      put: {
        operationId: "putDocument",
        summary: "Write MDX document and recompile (same as MCP write_content)",
        responses: { "200": { description: "Write + compile result" } },
      },
    },
    "/api/studio/v1/changes": {
      get: {
        operationId: "getChanges",
        summary: "Uncommitted content changes (git status, scoped to the content directory)",
        description:
          'Content is git-authoritative, so this is the Studio\'s real answer to "what have I changed?" — no draft table involved. Returns `tracked: false` with a reason rather than failing when the project is not a git repository.',
        responses: {
          "200": { description: "Changed files + the git branch a commit would land on" },
        },
      },
    },
    "/api/studio/v1/changes/diff": {
      get: {
        operationId: "getChangeDiff",
        summary: "Diff of one changed file against the last commit",
        description:
          "Parsed into hunks and numbered lines. A file git has never seen is returned as all-added; binary files return `binary: true` with no hunks.",
        parameters: [{ name: "path", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Hunks + added/removed counts" } },
      },
    },
    "/api/studio/v1/changes/commit": {
      post: {
        operationId: "commitChanges",
        summary: "Commit selected content files (local only — never pushes)",
        description:
          "Commits the work-tree state of exactly the given paths, leaving anything else the operator had staged alone. Paths must appear in the current change set. Fails with COMMIT_FAILED when git has no committer identity, and with GIT_UNAVAILABLE when the content directory is not in a work tree.",
        responses: { "200": { description: "The new commit" } },
      },
    },
    "/api/studio/v1/compilations": {
      get: {
        operationId: "listCompilations",
        summary: "Compilation trail",
        responses: { "200": { description: "Newest first" } },
      },
    },
    "/api/studio/v1/branches": {
      get: {
        operationId: "listBranches",
        summary: "Branch registry",
        responses: { "200": { description: "Branches" } },
      },
    },
    "/api/studio/v1/approvals": {
      get: {
        operationId: "listPendingApprovals",
        summary: "Pending approvals",
        responses: { "200": { description: "Pending queue" } },
      },
    },
    "/api/studio/v1/approvals/{id}/decide": {
      post: {
        operationId: "decideApproval",
        summary: "Approve or deny (same as graft approve/deny)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Decision recorded" } },
      },
    },
  },
} as const;
