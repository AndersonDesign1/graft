---
"@usegraft/studio": patch
---

Studio loads its editors when an entry opens, not with the app. Milkdown and
CodeMirror were about 2.7 MB of the 3.3 MB every Studio page downloaded
before it could show the home screen or a list. Now the first page loads
0.66 MB (201 kB gzipped), and opening an entry adds the editor (1.66 MB, 532
kB gzipped); the languages a code block highlights load only when one asks
for them. The same split applies to `@usegraft/studio/panels`, whose bundle
goes from 4.8 MB to 0.5 MB with the editor in a chunk of its own.
