---
"@usegraft/compiler": patch
"@usegraft/mcp": patch
"@usegraft/studio": patch
---

A save to a GitHub draft can no longer be lost while the draft is being emptied. Publishing everything or discarding the last change used to read the draft branch and then delete it, and a save that landed in between was deleted with it after reporting success. The draft is now emptied with a fast-forward that fails if the branch moved, so the branch stays, holding no changes, and the next save reuses it.

Invite-link editors get new draft branch names. Their key joins the hash with `--`, which a GitHub login cannot produce, so a login shaped like an email's key (`ana-lima-shop-test-0123456789`) no longer shares that person's draft. A draft saved under the old name before upgrading stays on GitHub as a branch: publish or discard it first, or merge it by hand.
