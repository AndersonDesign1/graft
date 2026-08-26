/**
 * Registry browsing — the owned-primitive catalogue.
 *
 * Read-only: adding an item is `graft add`, which copies files into the project.
 */
import { describeItem, listItems, loadItem } from "@usegraft/registry";
import { z } from "zod";
import { guarded } from "../tool-result";
import type { RegisterTools } from "./deps";

export const registerRegistryTools: RegisterTools = (server, deps) => {
  const { options } = deps;

  server.registerTool(
    "list_registry",
    {
      title: "List registry items",
      description:
        "List every owned primitive available to `graft add` — shadcn-style copy-in blocks / fields / access rules / bundles (name, type, one-line description, and any registry items it pulls in). Use describe_item for the full details, then install with `graft add <name>` from the CLI. MCP browses what exists; the CLI installs it.",
      inputSchema: {},
    },
    () =>
      guarded(() => ({
        items: listItems(options.registryRoot).map((item) => ({
          name: item.name,
          type: item.type,
          description: item.description,
          registryDependencies: item.registryDependencies,
        })),
      })),
  );

  server.registerTool(
    "describe_item",
    {
      title: "Describe a registry item",
      description:
        "Full details for one owned primitive: type, description, the files it writes into the project, npm dependencies to install, the registry items it pulls in first, and whether it ships an llms.txt fragment. Use list_registry for names; install with `graft add <name>` (CLI). MCP does not install.",
      inputSchema: {
        name: z.string().describe("Item name as returned by list_registry"),
      },
    },
    ({ name }) => guarded(() => describeItem(loadItem(name, options.registryRoot))),
  );
};
