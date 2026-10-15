---
"@usegraft/studio": patch
---

A contributor on a local Studio can no longer commit. Locally there is no review step, so a commit landed on the checkout at once, whatever the role. The contributor's drafts now wait for an editor: the Commit buttons are off with the reason, and the API refuses with `UNAUTHORIZED` and `details.required: "studio:publish"`.

A local commit is now authored by the signed-in person instead of whoever runs Studio, who stays the committer. With no message, it names the entries by title (`Update “Wool Hat”`) instead of by path, and the Publish sheet's placeholder shows that message.

A refusal now speaks to whoever was refused. A person is told their role can't do it and to ask an admin. A token is told the scope it lacks and where to make one that has it. Studio shows these messages instead of "You're signed out".
