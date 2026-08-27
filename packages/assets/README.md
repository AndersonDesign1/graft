# @usegraft/assets

> S3-compatible object storage for binary assets. Cloudflare R2, MinIO, Tigris, or anything speaking the same API.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/assets
```

## Use

```ts
import { createStorage, storageConfigFromEnv } from "@usegraft/assets";

const storage = createStorage(storageConfigFromEnv());
await storage.put(key, bytes, { contentType });
const url = await storage.url(key);
```

`storageConfigFromEnv` reads `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and the optional `S3_PUBLIC_URL`. Set `S3_PUBLIC_URL` for a stable public base; without it, reads come back as presigned GETs.

## Keys

`defaultKeyFor` and `contentTypeFor` derive a content-addressed key and a MIME type from a filename, so an agent uploading a file does not have to invent either.

```ts
import { defaultKeyFor, contentTypeFor } from "@usegraft/assets";
```

Upload from the CLI with `graft asset put <file> [key]`, and reference the result from a collection with `field.asset()`.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/feat/core/packages/assets/CHANGELOG.md)
