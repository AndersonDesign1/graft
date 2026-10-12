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
        responses: {
          "200": {
            description:
              "Change counts + git SHA, plus refresh ({ ok: true } or { ok: false, error, message, fix }) when the handler has onContentChange and content changed",
          },
        },
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
    "/api/studio/v1/workspace": {
      get: {
        operationId: "getWorkspace",
        summary: "Where saves land and what Publish does for the caller",
        description:
          "Storage (local or github), repository and branch, the publish action for this caller (commit, publish, or review), and who is signed in.",
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/studio/v1/people": {
      get: {
        operationId: "listPeople",
        summary: "Who can sign in with a Studio account, and open invitations",
        description:
          "Needs the studio:people scope (admins). Answers ROUTE_NOT_FOUND (404) when this Studio has no accounts.",
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/studio/v1/people/invites": {
      post: {
        operationId: "invitePerson",
        summary: "Invite someone by email, with a role",
        description:
          "Body: { email, name?, role }. Answers with the invitation link once; only its hash is stored. Inviting the same address again replaces the old link.",
        responses: { "201": { description: "Created" } },
      },
    },
    "/api/studio/v1/people/invites/{id}": {
      delete: {
        operationId: "revokeInvite",
        summary: "Revoke an invitation nobody has used yet",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "204": { description: "Revoked" } },
      },
    },
    "/api/studio/v1/people/{id}": {
      put: {
        operationId: "setPersonRole",
        summary: "Change someone's role",
        description: "Body: { role }. The last admin can't be given another role.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "204": { description: "Changed" } },
      },
      delete: {
        operationId: "removePerson",
        summary: "Take away someone's access, ending their sessions",
        description: "Nobody can remove their own access, and the last admin can't be removed.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "204": { description: "Removed" } },
      },
    },
    "/api/studio/v1/people/{id}/reset": {
      post: {
        operationId: "resetPassword",
        summary: "A link that sets a new password for someone, keeping their role",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "201": { description: "Created" } },
      },
    },
    "/api/studio/v1/entries": {
      get: {
        operationId: "listEntries",
        summary: "A page of a collection's entries, searched, filtered and sorted on the server",
        description:
          "Status per entry for the caller (published, changed, new, deleted), column values for scalar fields, facets for select, boolean and reference fields. Query: q, status (all | unpublished | <status>), where.<field>=<value>, sort (site | title | updated | <field>), dir, cursor, limit (max 500).",
        parameters: [
          { name: "collection", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/studio/v1/entry": {
      get: {
        operationId: "getEntry",
        summary: "One entry: fields, body, source and version",
        description: "Send `version` back as `baseVersion` when saving.",
        parameters: [
          { name: "collection", in: "query", required: true, schema: { type: "string" } },
          { name: "slug", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "OK" } },
      },
      put: {
        operationId: "saveEntry",
        summary: "Save an entry through the content store",
        description:
          "Validated like MCP write_content. Send the version you read as baseVersion: it is refused with CONTENT_CONFLICT (409) when that is no longer the current version. A save without baseVersion is unconditional.",
        responses: { "200": { description: "OK" } },
      },
      post: {
        operationId: "createEntry",
        summary: "Create an entry; the slug comes from the title when omitted",
        responses: { "201": { description: "Created" } },
      },
      delete: {
        operationId: "deleteEntry",
        summary: "Delete an entry (a draft change until published)",
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/studio/v1/entry/duplicate": {
      post: {
        operationId: "duplicateEntry",
        summary: "Copy an entry under a new slug",
        responses: { "201": { description: "Created" } },
      },
    },
    "/api/studio/v1/drafts": {
      get: {
        operationId: "listDrafts",
        summary: "The caller's unpublished changes and open review requests",
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/studio/v1/drafts/diff": {
      get: {
        operationId: "diffDraft",
        summary: "Line diff of a draft against the published version",
        parameters: [{ name: "path", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/studio/v1/entry/history": {
      get: {
        operationId: "entryHistory",
        summary: "What was published for one document, newest first",
        description:
          "Published revisions in a database-sourced project, commits to the production branch on GitHub, and the checkout's commits locally. available is false, with a reason, where there is no history.",
        parameters: [{ name: "path", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/studio/v1/entry/version": {
      get: {
        operationId: "entryVersion",
        summary: "One version of a document, and its diff to what the caller has now",
        description:
          "To restore it, save its raw bytes with PUT /entry: the restore is a draft like any other edit.",
        parameters: [
          { name: "path", in: "query", required: true, schema: { type: "string" } },
          { name: "id", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/studio/v1/activity": {
      get: {
        operationId: "activity",
        summary: "What was published lately across the content, newest first",
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", maximum: 100 },
          },
        ],
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/studio/v1/drafts/publish": {
      post: {
        operationId: "publishDrafts",
        summary:
          "Publish drafts: a commit locally, a commit on the production branch, or a pull request",
        description:
          "On GitHub storage, a caller without studio:publish, or any caller when GRAFT_STUDIO_PUBLISH=pull-request, opens a pull request; local storage commits. Conflicts are refused with CONTENT_CONFLICT listing each path; resend with resolve: { path: mine | theirs }.",
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/studio/v1/drafts/discard": {
      post: {
        operationId: "discardDrafts",
        summary: "Throw drafts away; the published version stands",
        responses: { "200": { description: "OK" } },
      },
    },
  },
} as const;
