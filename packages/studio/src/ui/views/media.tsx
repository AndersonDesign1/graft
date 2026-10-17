/**
 * The media library: every file in the asset store that Studio uploaded or an
 * entry uses, with its alt text and where it is used.
 *
 * The same library opens from an image field to pick a file, so a person
 * never types a storage key. Alt text written here is what a field starts
 * from when the file is picked; each entry can still say it its own way.
 */
import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import type { AssetDetailDto, AssetDto, AssetListDto } from "../../editor-types";
import {
  IconCopy,
  IconFile,
  IconPlus,
  IconSearch,
  IconTrash,
  IconWarning,
} from "../components/icons";
import { RequiresDatabase } from "../components/primitives";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { useConfirm } from "../components/ui/confirm";
import { ApiError, api, plainError, qs } from "../lib/api";
import { absoluteTime, plural, relativeTime } from "../lib/format";
import { collectionLabel, useDatabase, useStudio } from "../lib/studio";
import { useResource } from "../lib/use-resource";

const IMAGE = /^image\//;

/** Bytes as a person reads them: 980 B, 41 KB, 2.3 MB. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error(`Couldn't read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** Upload files one at a time, saying how each went. Returns the ones that landed. */
export async function uploadFiles(files: FileList | File[]): Promise<AssetDto[]> {
  const done: AssetDto[] = [];
  for (const file of Array.from(files)) {
    try {
      const asset = await api<AssetDto>("/assets", {
        method: "POST",
        body: JSON.stringify({
          name: file.name,
          base64: await readBase64(file),
        }),
      });
      done.push(asset);
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.code === "ASSET_EXISTS"
          ? `There is already a file called ${file.name}. Rename it and upload again.`
          : plainError(error),
      );
    }
  }
  if (done.length > 0) {
    toast.success(done.length === 1 ? `Uploaded ${done[0]?.key}` : `Uploaded ${done.length} files`);
  }
  return done;
}

function Thumb({ asset }: { asset: AssetDto }) {
  const image =
    asset.url &&
    (asset.contentType
      ? IMAGE.test(asset.contentType)
      : /\.(avif|gif|jpe?g|png|svg|webp)$/.test(asset.key));
  return (
    <span className="media-thumb">
      {image ? (
        <img src={asset.url ?? undefined} alt="" loading="lazy" />
      ) : (
        <IconFile size={20} aria-hidden="true" />
      )}
    </span>
  );
}

/**
 * The grid of files, searchable, with an upload button. `onPick` turns it into
 * a picker: a click chooses a file instead of opening its details.
 */
export function MediaLibrary(props: { onPick?: (asset: AssetDto) => void }) {
  return (
    <RequiresDatabase
      title="The media library needs a database"
      does="It records each file you upload, with its alt text and where it is used, in Postgres. You can still type a file's key into an image field."
    >
      <Library {...props} />
    </RequiresDatabase>
  );
}

function Library({ onPick }: { onPick?: (asset: AssetDto) => void }) {
  const { workspace } = useStudio();
  const [q, setQ] = useState("");
  const list = useResource<AssetListDto>(`/assets${qs({ q: q.trim() || undefined })}`, [q]);
  const [open, setOpen] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const canWrite = workspace.data?.canWrite ?? true;
  const items = list.data?.items ?? [];

  const upload = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    const done = await uploadFiles(files);
    setUploading(false);
    event.target.value = "";
    list.refresh();
    const first = done[0];
    if (onPick && first && done.length === 1) onPick(first);
  };

  return (
    <div className="media">
      <div className="media-bar">
        <label className="search">
          <IconSearch size={14} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by name or alt text"
            aria-label="Search files"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <input
          ref={input}
          type="file"
          multiple
          accept=".avif,.gif,.jpg,.jpeg,.png,.svg,.webp,.pdf"
          hidden
          onChange={(e) => void upload(e)}
        />
        <button
          type="button"
          className="btn"
          data-variant={onPick ? undefined : "primary"}
          disabled={!canWrite || uploading || list.data?.storage === false}
          onClick={() => input.current?.click()}
        >
          <IconPlus size={14} aria-hidden="true" />
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>

      {list.data?.storage === false ? (
        <p className="notice" data-tone="warn">
          <IconWarning size={14} />
          <span>
            Files can't be uploaded or shown yet: the asset store isn't set up where Studio runs.
            Set S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY and S3_BUCKET (any S3-compatible store),
            and S3_PUBLIC_URL for public links.
          </span>
        </p>
      ) : null}
      {list.error ? (
        <p className="notice" data-tone="error">
          {list.error}
        </p>
      ) : null}

      {list.data && items.length === 0 ? (
        <p className="media-empty">
          {q.trim()
            ? `Nothing matches "${q.trim()}".`
            : "No files yet. Upload images here, then pick them in any image field."}
        </p>
      ) : null}

      <ul className="media-grid" aria-label="Files">
        {items.map((asset) => (
          <li key={asset.key}>
            <button
              type="button"
              className="media-card"
              onClick={() => (onPick ? onPick(asset) : setOpen(asset.key))}
            >
              <Thumb asset={asset} />
              <span className="media-name">{asset.key.split("/").pop()}</span>
              <span className="media-meta">
                {[
                  asset.bytes !== null ? fileSize(asset.bytes) : null,
                  asset.uses === 0 ? "Not used" : `Used ${plural(asset.uses, "time")}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {open ? (
        <AssetDetail
          assetKey={open}
          onClose={() => setOpen(null)}
          onChanged={() => list.refresh()}
        />
      ) : null}
    </div>
  );
}

function AssetDetail({
  assetKey,
  onClose,
  onChanged,
}: {
  assetKey: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { workspace, navigate } = useStudio();
  const confirm = useConfirm();
  const detail = useResource<AssetDetailDto>(`/assets/detail${qs({ key: assetKey })}`);
  const [alt, setAlt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asset = detail.data;
  const canWrite = workspace.data?.canWrite ?? true;
  const canDelete = workspace.data?.user
    ? workspace.data.user.scopes.includes("studio:publish")
    : true;

  const saveAlt = (): void => {
    setBusy(true);
    api("/assets/alt", { method: "PUT", body: JSON.stringify({ key: assetKey, alt }) })
      .then(() => {
        toast.success("Alt text saved");
        detail.refresh();
        onChanged();
      })
      .catch((error: unknown) => toast.error(plainError(error)))
      .finally(() => setBusy(false));
  };

  const remove = async (): Promise<void> => {
    const ok = await confirm({
      kind: "delete",
      title: `Delete ${assetKey.split("/").pop()}?`,
      body: "It's removed from the asset store for good. Nothing uses it, so no page changes.",
      action: "Delete file",
    });
    if (!ok) return;
    setBusy(true);
    api(`/assets${qs({ key: assetKey })}`, { method: "DELETE" })
      .then(() => {
        toast.success("File deleted");
        onChanged();
        onClose();
      })
      .catch((error: unknown) => toast.error(plainError(error)))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="media-detail">
        <DialogTitle>{assetKey.split("/").pop()}</DialogTitle>
        {detail.error ? (
          <p className="notice" data-tone="error">
            {detail.error}
          </p>
        ) : null}
        {asset ? (
          <div className="media-detail-body">
            <div className="media-preview">
              <Thumb asset={asset} />
            </div>
            <dl className="inspector-facts">
              <div>
                <dt>Key</dt>
                <dd className="media-key">
                  <code>{asset.key}</code>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Copy the key"
                    onClick={() => {
                      void navigator.clipboard?.writeText(asset.key);
                      toast.success("Key copied");
                    }}
                  >
                    <IconCopy size={14} />
                  </button>
                </dd>
              </div>
              {asset.bytes !== null ? (
                <div>
                  <dt>File</dt>
                  <dd>{[asset.contentType, fileSize(asset.bytes)].filter(Boolean).join(", ")}</dd>
                </div>
              ) : null}
              {asset.createdAt ? (
                <div>
                  <dt>Uploaded</dt>
                  <dd title={absoluteTime(asset.createdAt)}>
                    {relativeTime(asset.createdAt)}
                    {asset.uploadedBy ? ` by ${asset.uploadedBy}` : ""}
                  </dd>
                </div>
              ) : null}
            </dl>

            {asset.bytes !== null ? (
              <label className="media-alt">
                <span className="fr-label">Alt text</span>
                <span className="fr-help">
                  What the image shows, for someone who can't see it. Image fields start from this
                  when the file is picked.
                </span>
                <textarea
                  className="input"
                  rows={2}
                  value={alt ?? asset.alt ?? ""}
                  disabled={!canWrite}
                  onChange={(e) => setAlt(e.target.value)}
                />
                <span>
                  <button
                    type="button"
                    className="btn"
                    data-size="sm"
                    disabled={!canWrite || busy || alt === null || alt === (asset.alt ?? "")}
                    onClick={saveAlt}
                  >
                    Save alt text
                  </button>
                </span>
              </label>
            ) : (
              <p className="muted">
                This file wasn't uploaded through Studio, so its alt text lives in each entry.
              </p>
            )}

            <section aria-labelledby="media-used">
              <h3 className="version-section" id="media-used">
                {asset.usedIn.length === 0
                  ? "Not used by any entry"
                  : `Used in ${plural(asset.usedIn.length, "place")}`}
              </h3>
              <ul className="media-uses">
                {asset.usedIn.map((use) => (
                  <li key={`${use.collection}/${use.slug}/${use.field}`}>
                    <a
                      className="link"
                      href={`#/c/${encodeURIComponent(use.collection)}/${encodeURIComponent(use.slug)}`}
                      onClick={() => {
                        onClose();
                        navigate({ view: "entry", collection: use.collection, slug: use.slug });
                      }}
                    >
                      {use.title}
                    </a>
                    <span className="muted">
                      {" "}
                      {collectionLabel(use.collection)}, {use.field}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {asset.bytes !== null ? (
              <div className="media-detail-actions">
                <button
                  type="button"
                  className="btn"
                  data-variant="ghost"
                  disabled={!canDelete || busy || asset.usedIn.length > 0}
                  title={
                    asset.usedIn.length > 0
                      ? "Take it out of the entries that use it first"
                      : undefined
                  }
                  onClick={() => void remove()}
                >
                  <IconTrash size={14} aria-hidden="true" />
                  Delete file
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function MediaView() {
  // Without a database the library can't keep uploads, and the panel below
  // says so; the line above it shouldn't promise otherwise.
  const database = useDatabase();
  return (
    <div className="view media-view">
      <header className="view-head">
        <div>
          <h1 className="view-title">Media</h1>
          <p className="view-sub">
            {database === false
              ? "Images and files the site uses."
              : "Images and files the site uses. Upload here, then pick them in any image field."}
          </p>
        </div>
      </header>
      <MediaLibrary />
    </div>
  );
}

/** The library as a picker, for an image field. */
export function MediaPicker({
  open,
  onOpenChange,
  onPick,
  onTypeInstead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (asset: AssetDto) => void;
  /** Offer to add an empty item whose key is typed, for files outside the library. */
  onTypeInstead?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="media-picker">
        <DialogTitle>Choose a file</DialogTitle>
        {open ? (
          <MediaLibrary
            onPick={(asset) => {
              onPick(asset);
              onOpenChange(false);
            }}
          />
        ) : null}
        {onTypeInstead ? (
          <div className="media-picker-foot">
            <button
              type="button"
              className="btn"
              data-variant="ghost"
              onClick={() => {
                onTypeInstead();
                onOpenChange(false);
              }}
            >
              Type a file key instead
            </button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
