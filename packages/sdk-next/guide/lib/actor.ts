import { createActorResolver } from "@usegraft/auth";

// A dev token never expires, so it is accepted only outside production.
const devToken = process.env.NODE_ENV === "production" ? undefined : process.env.GRAFT_DEV_TOKEN;

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
