import { defineCollection, field } from "@usegraft/core";

export const pages = defineCollection({
  name: "pages",
  fields: {
    title: field.string(),
  },
});

export const collections = { pages };

/** Not one of the three policies — loadConfig must refuse rather than default. */
export const approvalPolicy = "sometimes";
