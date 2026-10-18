---
"@usegraft/db": minor
---

`autoJoinAccount` creates a Studio account for an email that has never had one, with a given role. It returns null for an email that has or had an account, so someone an admin removed is not brought back, and null before the owner exists, so the first visit can still claim the Studio.
