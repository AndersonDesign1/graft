import { defineCollection, field } from "@usegraft/core";

export const pages = defineCollection({
  name: "pages",
  fields: {
    title: field.string(),
  },
});

export const collections = { pages };

/** Every author of this fixture has commit access, so code review is the control. */
export const mdxTrust = "full";
