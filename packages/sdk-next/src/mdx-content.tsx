/**
 * MdxContent — render MDX that prepareMdx compiled on the server.
 *
 * The Pages Router renders a page on the server and again in the browser, so
 * its component cannot be async and cannot carry the MDX compiler or a
 * database driver. prepareMdx (from `@usegraft/sdk-next`) runs in
 * getStaticProps or getServerSideProps and returns the compiled body as a
 * string, which travels in the page's props. This component turns that string
 * back into elements, on both sides, with nothing but React's JSX runtime.
 *
 * Shipped as its own entry, `@usegraft/sdk-next/mdx`, so a page that imports
 * it pulls in no server code.
 */
import type { MDXComponents } from "mdx/types";
import { useMemo, type ComponentType, type ReactElement } from "react";
import * as runtime from "react/jsx-runtime";

export interface MdxContentProps {
  /** The string prepareMdx returned. Empty renders nothing. */
  code: string;
  /** Component map, as for MdxBody. */
  components?: MDXComponents;
}

interface CompiledMdx {
  default: ComponentType<{ components: MDXComponents }>;
}

export function MdxContent({ code, components }: MdxContentProps): ReactElement | null {
  const Content = useMemo(() => {
    if (code.length === 0) return null;
    // The body was checked against the trust rule and compiled by
    // prepareMdx, on the server. What runs here is that output: a function
    // body that takes the JSX runtime and returns the MDX module.
    const module: CompiledMdx = new Function(code)({ ...runtime });
    return module.default;
  }, [code]);
  return Content ? <Content components={components ?? {}} /> : null;
}
