/**
 * `outputSchema` for the tools whose answer has a fixed shape.
 *
 * `structuredContent` alone is a convenience: the client gets an object instead
 * of a string it has to parse. Declaring the schema is what turns it into a
 * contract — the SDK validates every result against it before it leaves the
 * server, so a tool that quietly changes its shape fails here rather than in
 * whatever the agent tried to do with the answer.
 *
 * Where a contract already exists in `@usegraft/contracts` it is reused rather
 * than restated; `describe_schema`, `describe_function` and `describe_item`
 * were already published shapes with a drift test (`introspection.contract`),
 * and this attaches them to the wire.
 *
 * Two tools deliberately have no schema. `delete_content` spreads the deleted
 * function's own return over the top level, and `run_function` returns whatever
 * the project's function returns — both are open by construction, and a schema
 * that said `unknown` would be a contract promising nothing while costing a
 * validation pass. They keep `structuredContent` without the guarantee.
 */
// oxlint-disable anti-slop/no-shape-in-symbol-names -- `.shape` is Zod's accessor for
// an object schema's fields, not a name this file chose. registerTool takes the
// raw field map rather than the schema object, so reading it is the only way to
// reuse a published contract instead of restating it.
import { FunctionDescriptor, RegistryItemDescriptor, SchemaDescription } from "@usegraft/contracts";
import { z } from "zod";

/** Authored frontmatter: shaped by the project's collection, not by us. */
const DocumentData = z.record(z.string(), z.unknown());

const ChangeSet = z.object({
  added: z.array(z.string()),
  changed: z.array(z.string()),
  removed: z.array(z.string()),
  unchanged: z.number(),
});

export const listCollectionsOutput = {
  branch: z.string(),
  collections: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      authority: z.string(),
      fields: z.number(),
    }),
  ),
};

export const describeSchemaOutput = SchemaDescription.shape;

export const listFunctionsOutput = {
  branch: z.string(),
  functions: z.array(
    z.object({
      name: z.string(),
      kind: z.string(),
      description: z.string().optional(),
      public: z.boolean().optional(),
      destructive: z.boolean().optional(),
      args: z.number(),
    }),
  ),
};

export const describeFunctionOutput = FunctionDescriptor.shape;

export const listRegistryOutput = {
  items: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      description: z.string(),
      registryDependencies: z.array(z.string()).optional(),
    }),
  ),
};

export const describeItemOutput = RegistryItemDescriptor.shape;

export const listContentOutput = {
  collection: z.string(),
  documents: z.array(
    z.object({
      slug: z.string(),
      sourcePath: z.string(),
      data: DocumentData,
    }),
  ),
};

export const getContentOutput = {
  collection: z.string(),
  slug: z.string(),
  sourcePath: z.string(),
  data: DocumentData,
  body: z.string(),
};

export const searchContentOutput = {
  branch: z.string(),
  /** The resolved overlay chain, leaf-first — which branches were searched. */
  chain: z.array(z.string()),
  query: z.string(),
  hits: z.array(
    z.object({
      collection: z.string(),
      slug: z.string(),
      sourcePath: z.string(),
      rank: z.number(),
      snippet: z.string(),
      data: DocumentData,
    }),
  ),
};

export const writeContentOutput = {
  written: z.string(),
  branch: z.string(),
  /** Null when the content tree is not in a git checkout. */
  gitSha: z.string().nullable(),
  changes: ChangeSet,
};

export const listBranchesOutput = {
  branches: z.array(
    z.object({
      name: z.string(),
      parent: z.string().nullable(),
      backend: z.string(),
      status: z.string(),
      createdAt: z.string(),
      endpointHost: z.string().nullable(),
    }),
  ),
};

export const listCompilationsOutput = {
  compilations: z.array(
    z.object({
      id: z.string(),
      branchId: z.string(),
      gitSha: z.string().nullable(),
      docCount: z.number(),
      added: z.number(),
      changed: z.number(),
      removed: z.number(),
      createdAt: z.string(),
    }),
  ),
};

export const listApprovalsOutput = {
  approvals: z.array(
    z.object({
      id: z.string(),
      branchId: z.string(),
      functionName: z.string(),
      /** The canonical input the approval is bound to; jsonb, so open. */
      input: z.unknown(),
      requestedByKind: z.string(),
      requestedById: z.string().nullable(),
      correlationId: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
};

export const decideApprovalOutput = {
  id: z.string(),
  status: z.string(),
  decidedBy: z.string().nullable(),
  functionName: z.string(),
};

export const putAssetOutput = {
  key: z.string(),
  contentType: z.string(),
  bytes: z.number(),
  url: z.string(),
  /** A ready-to-paste `field.asset` frontmatter snippet. */
  frontmatter: z.string(),
};

/**
 * explain_error answers three different ways — the explanation, a "not a Graft
 * code" reply, and a "you passed neither argument" reply — so every field is
 * optional and the shape is the union of all three. Still worth declaring: it
 * tells a client which keys can ever appear.
 */
export const explainErrorOutput = {
  code: z.string().optional(),
  known: z.boolean().optional(),
  meaning: z.string().optional(),
  typicalCauses: z.array(z.string()).optional(),
  howToRecover: z.string().optional(),
  /** The `fix` off the actual error, which beats the general advice. */
  specificFix: z.string().optional(),
  message: z.string().optional(),
  knownCodes: z.array(z.string()).optional(),
  hint: z.string().optional(),
};
