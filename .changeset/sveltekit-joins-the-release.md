---
"@usegraft/sdk-sveltekit": patch
"@usegraft/cli": patch
---

Publish `@usegraft/sdk-sveltekit`. It sat at `0.1.0` and `private` while every
other package in the workspace was at `0.2.0`, and `private` is what kept it
there. The release config puts every `@usegraft/*` package in one `fixed`
group, and changesets counts a private package as ignored, so naming this one
beside any other failed the mixed-changeset check and the release plan refused
to build. That left no way to ship a fix for it at all, and it fell one version
further behind on each release. It is public at `0.2.0` now and versions with
everything else.

Nothing in the package itself changed. The README, the adapter and its tests
were already written and are untouched. `src/` still tracks
`@usegraft/sdk-astro`: the same `createGraft` and `graftRoute`, differing only
in doc comments, the `context` to `event` rename that SvelteKit's
`RequestEvent` asks for, and the URL one test uses as a fixture. That adapter
is exercised by `examples/docs-site`, so this code path has been covered all
along and only the packaging held it back.

Pin the MinIO images in the self-host Dockerfile to digests. `minio/minio` and
`minio/mc` were both on `latest`, which MinIO moves on every release, so the
image the README tells people to `docker run` could change from one build to
the next while nothing in this repo did, and a bad upstream release would
arrive with no way to tell what had shifted. Every GitHub Action here is
already SHA-pinned for that reason.
