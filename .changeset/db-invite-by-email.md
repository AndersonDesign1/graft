---
"@usegraft/db": minor
---

`acceptInviteForEmail` uses the newest open Studio invitation for an email, for someone who proved they own the address another way, such as a verified email from GitHub, Google or single sign-on. It only creates or restores an account: for someone who can already sign in, an invitation is a password reset and still takes its link. An account made that way stores `NO_PASSWORD_HASH`, and `StudioAccount.hasPassword` says whether an account has a password.
