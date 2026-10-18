---
"@usegraft/studio": minor
---

`GRAFT_STUDIO_AUTO_JOIN` lets a whole email domain join a hosted Studio without invitations: `GRAFT_STUDIO_AUTO_JOIN="shop.example.com=contributor"`. The first time someone signs in with GitHub, Google or single sign-on and has a verified email at the domain, Studio makes them an account with the domain's role (contributor by default), shown in Settings, People, where an admin can change or remove it. Someone removed stays out. Admin is never given this way, free mail providers such as gmail.com are refused, and nobody joins before the owner exists. People lists the domains that join on their own.
