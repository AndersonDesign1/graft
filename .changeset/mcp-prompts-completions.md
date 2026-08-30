---
"@usegraft/mcp": patch
---

Add prompts and argument completion.

Four prompts, each filled in from the live project: `author-document` and
`plan-migration` carry the collection's actual field list, `revise-document`
carries the document's resource URI, and `fix-error` resolves the recovery text
from this build's own error knowledge. A prompt that only said "author a
document nicely" would be a sentence the user could have typed, and would carry
no reason to live on the server.

They also encode the order of operations an agent has no way to infer:
`write_content` validates before it writes, `write_content` replaces rather than
patches so untouched frontmatter must come back byte-identical, migrations are
reviewable commits, and `graft migrate --apply` is the operator's consent to
propose rather than to run.

Prompt arguments and resource-template variables autocomplete from what exists:
collection names, document slugs narrowed to the collection already chosen, and
error codes matched case-insensitively. Picking a collection that is not
registered is a mistake the server can prevent rather than diagnose.
