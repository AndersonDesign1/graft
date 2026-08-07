/**
 * Collection marks.
 *
 * Initial letters ("D", "P", "S") were placeholder thinking: they carry no
 * meaning a name doesn't already, and three collections starting with the
 * same letter become indistinguishable. Collections are user-defined, so we
 * can't ship an icon per collection — but the common shapes of a CMS are
 * predictable, so match on the name and fall back to authority.
 *
 * The hue still comes from `--identity`, so two collections that happen to
 * share an icon stay tellable apart.
 */
import {
  IconApprovals,
  IconBranches,
  IconCollections,
  IconDatabase,
  IconFile,
  IconSchema,
  IconSettings,
  IconStack,
  type IconComponent,
} from "./icons";
import { identityIndex } from "../lib/format";

/** name fragment -> icon. First match wins, so order is specificity. */
const BY_NAME: Array<[RegExp, IconComponent]> = [
  [/^docs?$|documentation/i, IconCollections],
  [/^pages?$|^site$/i, IconFile],
  [/^posts?$|^blog|article|news/i, IconFile],
  [/submission|contact|message|inbox|lead/i, IconApprovals],
  [/product|item|catalog|sku/i, IconStack],
  [/author|user|member|team|person|people/i, IconBranches],
  [/setting|config|option/i, IconSettings],
  [/schema|type|model/i, IconSchema],
];

export function collectionIcon(name: string, authority: "file" | "db"): IconComponent {
  for (const [pattern, Icon] of BY_NAME) {
    if (pattern.test(name)) return Icon;
  }
  // Nothing recognised: say where it lives, which is the next most useful fact.
  return authority === "db" ? IconDatabase : IconFile;
}

export function CollectionMark({
  name,
  authority = "file",
  size = "md",
}: {
  name: string;
  authority?: "file" | "db";
  size?: "sm" | "md";
}) {
  const Icon = collectionIcon(name, authority);
  return (
    <span
      className="identity"
      data-size={size}
      style={{ "--identity": `var(--identity-${identityIndex(name)})` } as React.CSSProperties}
      aria-hidden="true"
    >
      <Icon size={size === "sm" ? 12 : 13} />
    </span>
  );
}
