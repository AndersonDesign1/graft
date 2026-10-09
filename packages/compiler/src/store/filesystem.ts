/**
 * The content store for a writable checkout: today's behaviour, behind the
 * interface. Bytes go to `<contentDir>/<path>`; recompiling is the caller's
 * job, because a filesystem write is what the compiler reads next.
 *
 * It has no draft workflow of its own. Locally, uncommitted files are the
 * draft and a commit is the publish; Studio supplies that over the working
 * tree with git, where it already lived.
 */
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolveContained } from "../paths";
import { writeDocumentFile } from "../serialize";
import { gitBlobSha } from "./blob";
import { assertBaseVersion } from "./conflict";
import type { ContentStore, StoredFile, StoreInfo, WriteOptions } from "./types";

export class FilesystemStore implements ContentStore {
  readonly kind = "filesystem" as const;

  constructor(private readonly contentDir: string) {}

  info(): StoreInfo {
    return { kind: "filesystem" };
  }

  async read(path: string): Promise<StoredFile | null> {
    const full = resolveContained(this.contentDir, path, { label: "content path" });
    if (!existsSync(full)) return null;
    const raw = readFileSync(full, "utf8");
    return { raw, version: gitBlobSha(raw) };
  }

  async write(
    path: string,
    raw: string | null,
    options: WriteOptions,
  ): Promise<{ version: string | null }> {
    const full = resolveContained(this.contentDir, path, { label: "content path" });
    const current = existsSync(full) ? gitBlobSha(readFileSync(full)) : null;
    assertBaseVersion(path, options.baseVersion, current);
    if (raw === null) {
      if (current !== null) unlinkSync(full);
      return { version: null };
    }
    writeDocumentFile(this.contentDir, path, raw);
    return { version: gitBlobSha(raw) };
  }
}
