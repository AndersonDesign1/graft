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
        summary: "Content tree",
        parameters: [{ name: "branch", in: "query", schema: { type: "string" } }],
        responses: { "200": { description: "Collections → documents" } },
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
