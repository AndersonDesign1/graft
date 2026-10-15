---
"@usegraft/db": minor
"@usegraft/compiler": minor
"@usegraft/studio": patch
---

A local Studio save now updates the index for the file it wrote, instead of
recompiling the whole content tree. On a 2,000-product catalog a save took
1.6 seconds and now takes about 100 milliseconds.

The save checks the file with the same rules as `graft compile` (the schema,
MDX safety, unique slugs) and records a compilation with the commit it was
read at, so the compile history still lists it. Other files are left as they
are: a file changed outside Studio reaches the index on the next
`graft compile`. One broken file elsewhere in the tree no longer makes every
save fail.

Two functions make this available outside Studio:

```ts
import { compileDocuments } from "@usegraft/compiler";

// Read, validate and project two files; a missing one comes off the index.
await compileDocuments({ contentDir, collections, db, paths: ["products/wool-hat.mdx"] });
```

`projectDocuments` in `@usegraft/db` is the projection underneath, and it is
the one a database-sourced publish already used. It changes only the rows it
is given, refuses a slug another live file holds with `SLUG_NOT_UNIQUE`, and
removes a row whose file no longer produces it.
