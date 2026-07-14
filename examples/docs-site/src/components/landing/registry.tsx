"use client";

/**
 * `graft add commerce` → owned files stagger into the tree. The point is the
 * ownership model: primitives land as code in your repo, not a plugin.
 */
import { useInView } from "./reveal";

const DROPPED = [
  "graft/commerce.ts",
  "graft/fields/seo.ts",
  "components/order-form.tsx",
  "llms.txt § commerce",
];

export function RegistryDrop() {
  const { ref, inView } = useInView<HTMLUListElement>("-100px");
  return (
    <div className="registry-demo">
      <div>
        <ul ref={ref} className={`file-tree ${inView ? "in" : ""}`}>
          <li className="dim">$ graft add commerce</li>
          <li className="dim">your-app/</li>
          <li className="dim">├─ graft.config.ts</li>
          <li className="dim">├─ content/</li>
          {DROPPED.map((f, i) => (
            <li
              key={f}
              className="added"
              style={{ "--drop-delay": `${200 + i * 160}ms` } as React.CSSProperties}
            >
              ├─ {f}
            </li>
          ))}
          <li className="dim">└─ …</li>
        </ul>
      </div>
      <div>
        <p className="section-lede" style={{ marginBottom: "1rem" }}>
          Primitives are <code>shadcn</code>-style: <strong>owned, not installed</strong>. A
          collection, its functions, and the llms.txt fragment that teaches agents to use it —
          dropped into your repo as plain TypeScript you can read, edit, and delete.
        </p>
        <p className="pipeline-note">
          <b>No plugin black box.</b> Dup keys fail loudly (<code>CONFIG_INVALID</code>); types
          stay fully inferred through <code>mergePrimitives</code>.
        </p>
      </div>
    </div>
  );
}
