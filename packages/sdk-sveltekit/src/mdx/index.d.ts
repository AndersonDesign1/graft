import type { Component } from "svelte";
import type { MdxTree } from "../server.js";

export type { MdxNode, MdxTree } from "../server.js";

/** Components the MDX body may use, by the name it uses them under. */
export type MdxComponents = Record<string, Component<any>>;

/**
 * Render a body `prepareMdx` prepared on the server. A component the body
 * names renders only if `components` has it; one it lacks renders its content
 * without the wrapper. Nothing in the tree is evaluated.
 */
export declare const MdxContent: Component<{ tree: MdxTree; components?: MdxComponents }>;
