import { defineCollection, field } from "@usegraft/core";

export const pages = defineCollection({
  name: "pages",
  fields: {
    title: field.string(),
  },
});

export const collections = { pages };

/** A scheduled-job deployment: nothing is gated, including destructive functions. */
export const approvalPolicy = "unattended";
