---
"@usegraft/db": minor
"@usegraft/studio": minor
"@usegraft/cli": minor
---

Studio accounts: people sign in to a hosted Studio with an email and a password.

- The first visit creates the owner account. On a server anyone can reach,
  it asks for a setup code first, which `graft serve` prints when it starts
  and `graft studio setup-code` prints from the site's settings.
- Admins invite people from Settings, People: an email and a role make a link
  to pass on. The same list changes roles, makes a link to set a new password,
  and removes access, which signs that person out at once.
- Account sessions live in the database, so signing out, removing someone or
  changing their role takes effect on their next request. Changing your
  password signs out your other browsers. Five wrong passwords in a row lock
  an account for 15 minutes.
- Admins get the new `studio:people` scope. GitHub sign-in and
  `graft studio invite` links work as before.
- New tables `studio_users`, `studio_sessions` and `studio_invites`: run
  `graft db migrate`, and `graft harden <role>` again if you use a runtime role.
