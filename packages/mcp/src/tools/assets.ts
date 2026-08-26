/**
 * put_asset — binaries into the asset store.
 *
 * The `path` argument reads from the machine running the server and therefore exists only when the mount granted a root to read from.
 */
import { readFileSync } from "node:fs";
import { contentTypeFor, defaultKeyFor } from "@usegraft/assets";
import { AssetRef } from "@usegraft/core";
import { resolveContained } from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";
import { z } from "zod";
import { guarded } from "../tool-result";
import type { RegisterTools } from "./deps";

export const registerAssetTools: RegisterTools = (server, deps) => {
  const { getStorage, options, requireScope } = deps;
  // Enables the `path` argument at all; unset on every remote mount.
  const uploadRoot = options.localUploadRoot;

  server.registerTool(
    "put_asset",
    {
      title: "Upload an asset (image / binary)",
      description:
        (uploadRoot
          ? "Upload a binary to the asset store and get the frontmatter reference for an `asset` field. Pass `path` (a file inside this project) OR `base64` + `key`. "
          : "Upload a binary to the asset store and get the frontmatter reference for an `asset` field. Pass `base64` + `key` — this server reads no files from its own disk. ") +
        "Refuses to overwrite an existing key unless overwrite: true — the store keeps no version history. Then reference the returned key from an asset field via write_content.",
      inputSchema: {
        key: z
          .string()
          .optional()
          .describe(
            'Asset key — a lowercase path like "pages/pricing/hero.png". Required with base64; defaults to assets/<filename> with path.',
          ),
        path: z
          .string()
          .optional()
          .describe(
            uploadRoot
              ? `Path to a file inside ${uploadRoot} (local/stdio agents).`
              : "Not available on this server — send the bytes as `base64` instead.",
          ),
        base64: z
          .string()
          .optional()
          .describe("The file's bytes, base64-encoded (remote/HTTP agents)."),
        contentType: z
          .string()
          .optional()
          .describe("MIME type. Defaults to an inference from the key/path extension."),
        overwrite: z
          .boolean()
          .optional()
          .describe("Replace an existing binary at this key. Off by default."),
      },
    },
    ({ key: keyArg, path, base64, contentType, overwrite }) =>
      guarded(async () => {
        requireScope("put_asset", "content:write");
        if ((path === undefined) === (base64 === undefined)) {
          throw new GraftError({
            code: "INPUT_VALIDATION_FAILED",
            message:
              "Pass exactly one of `path` (a file on the MCP server's machine) or `base64` (the file's bytes).",
            fix: "Local/stdio agents: pass path. Remote/HTTP agents: read the file yourself and pass base64 + key.",
          });
        }

        let bytes: Uint8Array;
        if (path !== undefined) {
          if (uploadRoot === undefined) {
            throw new GraftError({
              code: "UNAUTHORIZED",
              message: "This server does not read files from its own disk.",
              fix: "Read the file yourself and send its bytes as `base64` with a `key`. Reading server-local paths is only available to a local stdio server, which grants it explicitly.",
              details: { tool: "put_asset" },
            });
          }
          // Contained, and symlinks refused: the argument exists so a local
          // agent can upload a file from the project, not so any caller can
          // read whatever the server process can.
          const full = resolveContained(uploadRoot, path, {
            label: "asset source",
            allowAbsolute: true,
          });
          try {
            bytes = readFileSync(full);
          } catch {
            throw new GraftError({
              code: "DOCUMENT_NOT_FOUND",
              message: `File not found: ${path}`,
              fix: "Pass a path to a file that exists on the machine running this MCP server, or send the bytes as base64 instead.",
              details: { path },
            });
          }
        } else {
          if (!/^[A-Za-z0-9+/=\s]+$/.test(base64!)) {
            throw new GraftError({
              code: "INPUT_VALIDATION_FAILED",
              message: "`base64` contains characters outside the base64 alphabet.",
              fix: "Encode the file's raw bytes as standard base64 (A-Z a-z 0-9 + / =). To upload a file by its location on the server's machine, use `path` instead.",
            });
          }
          bytes = Buffer.from(base64!, "base64");
        }

        const key = keyArg ?? (path !== undefined ? defaultKeyFor(path) : undefined);
        if (key === undefined) {
          throw new GraftError({
            code: "INPUT_VALIDATION_FAILED",
            message: "`key` is required when uploading via base64.",
            fix: 'Pass a lowercase path key naming the asset, e.g. "pages/pricing/hero.png".',
          });
        }
        const keyCheck = AssetRef.shape.key.safeParse(key);
        if (!keyCheck.success) {
          throw new GraftError({
            code: "INPUT_VALIDATION_FAILED",
            message: `"${key}" is not a valid asset key.`,
            fix: 'Use a lowercase path of letters, digits, ".", "_", "-" with "/" separators, each segment starting alphanumeric — e.g. "pages/pricing/hero.png".',
            details: { key },
          });
        }

        const storage = await getStorage();
        if (overwrite !== true && (await storage.exists(key))) {
          throw new GraftError({
            code: "ASSET_EXISTS",
            message: `Asset key "${key}" already holds a binary.`,
            fix: "Pick a distinct key (the store keeps no version history), or pass overwrite: true if replacing the existing binary is the actual intent.",
            details: { key },
          });
        }

        const type = contentType ?? contentTypeFor(key);
        await storage.put(key, bytes, type);
        return {
          key,
          contentType: type,
          bytes: bytes.byteLength,
          url: await storage.url(key),
          frontmatter: `image:\n  key: ${key}\n  alt: describe the image for screen readers`,
        };
      }),
  );
};
