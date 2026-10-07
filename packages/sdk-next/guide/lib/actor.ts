import { createActorResolver } from "@usegraft/auth";

export const actor = createActorResolver({
  devTokens: process.env.GRAFT_DEV_TOKEN
    ? {
        [process.env.GRAFT_DEV_TOKEN]: {
          kind: "human",
          id: "owner",
          scopes: ["content:write", "submissions:admin"],
        },
      }
    : undefined,
});
