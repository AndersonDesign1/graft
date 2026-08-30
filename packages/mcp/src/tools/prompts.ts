/**
 * Prompts — the workflows this project supports, offered rather than recalled.
 *
 * A prompt is user-initiated: a client surfaces these as commands someone picks
 * on purpose. That makes them worth shipping only when the server knows
 * something the person typing does not, so each one is filled in from the live
 * project — the collection's actual fields, the document's actual body, the
 * error's actual recovery text. A prompt that just says "author a document
 * nicely" is a sentence the user could have typed, and carries no reason to
 * live on the server.
 *
 * They also encode the order of operations this codebase cares about and an
 * agent has no way to infer: validate against the schema before writing,
 * migrations are reviewable commits rather than live edits, and a destructive
 * call is expected to stop and wait for a human rather than route around the
 * refusal.
 *
 * Arguments autocomplete from what exists. Picking a collection that is not
 * registered is a mistake the server can prevent rather than diagnose.
 */
import { z } from "zod";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { readCollectionDocs } from "@usegraft/compiler";
import { ERROR_KNOWLEDGE, explainCode } from "../explain";
import { documentUri } from "./resource-uri";
import type { RegisterTools } from "./deps";

/** One user message; every prompt here is a single instruction block. */
const say = (text: string) => ({
  messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
});

export const registerContentPrompts: RegisterTools = (server, deps) => {
  const { branchId, collections, contentDir } = deps;

  const fileCollections = (): string[] =>
    Object.values(collections)
      .filter((collection) => collection.describe().authority !== "db-authoritative")
      .map((collection) => collection.describe().name);

  const slugsIn = (name: string): string[] => {
    const collection = collections[name];
    if (!collection) return [];
    try {
      return readCollectionDocs(contentDir, name, collection).map((doc) => doc.slug);
    } catch {
      return [];
    }
  };

  /** The fields an author must satisfy, spelled out so no lookup is needed. */
  const fieldLines = (name: string): string => {
    const collection = collections[name];
    if (!collection) return "(unknown collection)";
    return collection
      .describe()
      .fields.map((field) => {
        const optional = field.optional ? " (optional)" : " (required)";
        const description = field.description ? ` — ${field.description}` : "";
        return `- ${field.name}: ${field.type}${optional}${description}`;
      })
      .join("\n");
  };

  const collectionArg = completable(z.string().describe("Collection name"), (value) =>
    fileCollections().filter((name) => name.startsWith(value)),
  );

  server.registerPrompt(
    "author-document",
    {
      title: "Author a document",
      description:
        "Write a new document into a collection, with that collection's actual field list already filled in.",
      argsSchema: {
        collection: collectionArg,
        topic: z.string().describe("What the document should be about"),
      },
    },
    ({ collection, topic }) =>
      say(
        [
          `Author a new document in the "${collection}" collection of this Graft project. Topic: ${topic}`,
          "",
          "Frontmatter must satisfy these fields exactly:",
          fieldLines(collection),
          "",
          "How to do it:",
          "1. Choose a kebab-case slug. It becomes the filename and the URL segment.",
          "2. Call write_content with the collection, the slug, the frontmatter as `data`, and the MDX body.",
          "3. write_content validates against the schema and compiles in one step — a schema failure comes back with a fix, so read it and correct the data rather than retrying unchanged.",
          "",
          "Body rules: prose and Markdown. Components are allowed only with literal attributes — the MDX safety gate refuses `{expressions}` and `import`, because rendering evaluates them as JavaScript on the server.",
          "",
          "Git owns the version history. If you are working in the server's checkout, commit the file afterwards; if you are remote, the checkout's operator owns the commit and you do not need to.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "revise-document",
    {
      title: "Revise a document",
      description:
        "Edit an existing document, with its current content and its address already attached.",
      argsSchema: {
        collection: collectionArg,
        slug: completable(z.string().describe("Document slug"), (value, context) => {
          const chosen = context?.arguments?.collection;
          const candidates = chosen ? slugsIn(chosen) : fileCollections().flatMap(slugsIn);
          return candidates.filter((slug) => slug.startsWith(value));
        }),
        goal: z.string().describe("What should change"),
      },
    },
    ({ collection, slug, goal }) =>
      say(
        [
          `Revise "${collection}/${slug}" in this Graft project. Goal: ${goal}`,
          "",
          `Read it first: ${documentUri(branchId, collection, slug)} (or get_content).`,
          "",
          "Frontmatter fields for this collection:",
          fieldLines(collection),
          "",
          "Then call write_content with the same collection and slug. Send the full frontmatter and body, not a patch — write_content replaces the document.",
          "",
          "Change only what the goal asks for. Frontmatter keys you are not changing must come back byte-identical: the writer preserves untouched lines, and a reformatted file is a diff the author has to review for nothing.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "fix-error",
    {
      title: "Recover from a Graft error",
      description:
        "Turn a GraftError into the next action, with this build's recovery text already resolved.",
      argsSchema: {
        code: completable(
          z.string().describe("The error code, e.g. SCHEMA_VALIDATION_FAILED"),
          (value) =>
            Object.keys(ERROR_KNOWLEDGE).filter((code) => code.startsWith(value.toUpperCase())),
        ),
      },
    },
    ({ code }) => {
      const explanation = explainCode(code);
      if (!explanation) {
        return say(
          [
            `"${code}" is not a Graft error code.`,
            "",
            `Call explain_error with no arguments to list the ${Object.keys(ERROR_KNOWLEDGE).length} codes this build knows, or pass the full GraftError JSON as \`error\`.`,
            "If it came from another system, resolve it there — Graft has nothing to say about it.",
          ].join("\n"),
        );
      }

      return say(
        [
          `Recover from ${code} in this Graft project.`,
          "",
          `What it means: ${explanation.meaning}`,
          "",
          "Usually because:",
          ...explanation.typicalCauses.map((cause) => `- ${cause}`),
          "",
          `How to recover: ${explanation.howToRecover}`,
          "",
          "The failing call's own `fix` is more specific than this page and beats it wherever the two differ — this is the general lesson behind the code, that was the advice for the one failure.",
        ].join("\n"),
      );
    },
  );

  server.registerPrompt(
    "plan-migration",
    {
      title: "Plan a schema migration",
      description:
        "Change a collection's shape without breaking the documents already written against it.",
      argsSchema: {
        collection: collectionArg,
        change: z.string().describe("The schema change, e.g. add a required `description`"),
      },
    },
    ({ collection, change }) =>
      say(
        [
          `Plan a migration for the "${collection}" collection of this Graft project. Change: ${change}`,
          "",
          "Current fields:",
          fieldLines(collection),
          "",
          "How migrations work here — they are code, not a console action:",
          "1. Edit the collection in graft.config.ts (or under graft/) to the new shape.",
          "2. `graft compile` now fails, once per document that no longer satisfies the schema. That is the point: the failure names every file to fix.",
          "3. Write `migrations/<seq>-<name>.ts` default-exporting defineContentMigration. It transforms old-shape frontmatter, validates every output against the NEW schema, and rewrites the files all-or-nothing.",
          "4. `graft migrate` is a dry run. `graft migrate --apply` is the operator's consent, and is theirs to give — propose the command, do not assume it.",
          "5. Compile again, then commit. The migration is a reviewable commit, which is the whole reason it is a file rather than a live edit.",
          "",
          "For a db-authoritative collection use defineDataMigration instead: it backfills data_records and writes its ledger row in one transaction.",
        ].join("\n"),
      ),
  );
};
