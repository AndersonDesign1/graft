---
"@usegraft/compiler": minor
"@usegraft/mcp": patch
"@usegraft/studio": patch
---

**BREAKING:** `writeDocumentFile(root, sourcePath, raw)` replaces
`writeDocumentFile(fullPath, raw)`, and contains the path itself. It returns
the resolved path.

`.greptile/rules.md` told reviewers that "every filesystem sink in
`@usegraft/compiler` performs path containment with symlink refusal". That was
false. `writeDocumentFile` took an already-resolved path and wrote it. Studio
resolved carefully before calling — its source even carries a comment about
`"../../../../tmp/pwn"` arriving as a clean-looking `"pwn"` — while MCP's
`write_content` did not, which is how a traversal shipped in a package whose
own review rules said it could not.

Containment that lives in each caller is not an invariant, because the next
caller does not inherit it. The sink no longer trusts its input, so the rule is
now true rather than aspirational. The rule text was corrected too, and says
what went wrong, since a rule that has been false once is worth annotating.

Raised by cubic on the pull request, against the rules file rather than the
code.
