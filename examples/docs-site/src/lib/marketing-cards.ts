/**
 * The social card for each marketing page, keyed by its path. The Marketing
 * layout points og:image at /og/site/<key>.png for the page it renders.
 */
export const MARKETING_CARDS = {
  home: {
    section: "Open-source CMS",
    title: "The native CMS for agents and humans",
    description:
      "Your content in your own repo. Agents edit it safely, and your team gets an editor in the browser.",
  },
  agents: {
    section: "For agents",
    title: "Agents that edit content without breaking it",
    description:
      "What an AI agent can do in a Graft project, how it connects, and the limits that keep your content safe.",
  },
  studio: {
    section: "Studio",
    title: "An editor your team can use today",
    description: "Find, create, edit and publish content in a browser, with no files to touch.",
  },
  start: {
    section: "Get started",
    title: "Let your agent set up your site",
    description:
      "Paste one sentence into the agent you use. It asks three questions, then sets up your site.",
  },
  why: {
    section: "Why Graft",
    title: "A CMS built for how people ship now",
    description: "Why a CMS built for agents and the people who run them.",
  },
  security: {
    section: "Security",
    title: "Let the agent drive. Keep the keys.",
    description: "How Graft keeps an agent-operated site safe.",
  },
} as const;

export type MarketingCard = keyof typeof MARKETING_CARDS;

/** The card for a path, or the home card for any page without its own. */
export const cardFor = (pathname: string): MarketingCard => {
  const key = pathname.replace(/^\/+|\/+$/g, "") || "home";
  return key in MARKETING_CARDS ? (key as MarketingCard) : "home";
};
