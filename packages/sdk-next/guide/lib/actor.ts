import { createActorResolver } from "@usegraft/auth";

// A dev token never expires, so it is accepted only in development. An unset
// NODE_ENV counts as production, so a deploy that forgets it stays closed.
const devToken = process.env.NODE_ENV === "development" ? process.env.GRAFT_DEV_TOKEN : undefined;

export const actor = createActorResolver({
  devTokens: devToken
    ? {
        [devToken]: {
          kind: "human",
          id: "owner",
          scopes: ["content:write", "submissions:admin"],
        },
      }
    : undefined,
});
