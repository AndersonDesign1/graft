/**
 * MdxContent: render MDX that `prepareMdx` (from `@usegraft/sdk-vue/server`)
 * compiled on the server.
 *
 * Vue renders a page on the server and again in the browser to hydrate it, so
 * this component cannot be async and cannot carry the MDX compiler. The
 * compiled body travels as a string, in a server route's response or Nuxt's
 * `useAsyncData` payload, and this turns it back into Vue nodes on both sides
 * with nothing but Vue itself.
 *
 * It runs the compiled body with `new Function`, as sdk-next's MdxContent
 * does. That body was checked against the trust rule by `prepareMdx`, so the
 * string must come from your server, never from user input. A page served with
 * a Content-Security-Policy needs `'unsafe-eval'` in `script-src` for it.
 */
import {
  createVNode,
  defineComponent,
  Fragment,
  h,
  isVNode,
  type Component,
  type PropType,
  type VNode,
  type VNodeTypes,
} from "vue";

/** Components the MDX body may use, by the name it uses them under. */
export type MdxComponents = Record<string, Component>;

interface CompiledMdx {
  default: Component;
}

interface JsxProps {
  children?: unknown;
  key?: string;
  [name: string]: unknown;
}

/**
 * The JSX runtime the compiled body calls, over Vue's `createVNode`, which
 * takes children of any shape where `h`'s overloads do not.
 *
 * Vue's own `vue/jsx-runtime` passes a component's children as a plain value,
 * which works but makes Vue warn on every component with content. A component
 * takes its content as a slot, so children go in as the default slot. Elements
 * and fragments take children directly.
 */
function jsx(type: VNodeTypes, props: JsxProps, key?: string): VNode {
  const { children, ...rest } = props;
  if (key !== undefined) rest.key = key;
  if (typeof type !== "string" && type !== Fragment && children !== undefined) {
    return createVNode(type, rest, { default: () => children });
  }
  // A lone child node in an element is read as a slots object and dropped
  // unless it is in an array, which is what `h` does for it too.
  return createVNode(type, rest, isVNode(children) ? [children] : children);
}

const runtime = { Fragment, jsx, jsxs: jsx };

export const MdxContent = defineComponent({
  name: "MdxContent",
  props: {
    /** The string prepareMdx returned. Empty renders nothing. */
    code: { type: String, required: true },
    /** Component map: every component the body uses, by name. */
    components: { type: Object as PropType<MdxComponents>, default: () => ({}) },
  },
  setup(props) {
    let compiledFor: string | undefined;
    let Content: Component | undefined;
    return () => {
      if (props.code.length === 0) return null;
      if (Content === undefined || props.code !== compiledFor) {
        // A function body that takes the JSX runtime and returns the module.
        const module: CompiledMdx = new Function(props.code)(runtime);
        Content = module.default;
        compiledFor = props.code;
      }
      return h(Content, { components: props.components });
    };
  },
});
