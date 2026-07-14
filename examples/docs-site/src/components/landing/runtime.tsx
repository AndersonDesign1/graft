"use client";

/**
 * The two topologies (identical bytes): embedded in your framework, or the
 * one-container `graft serve`. The container card boots line by line on view.
 */
import { useInView } from "./reveal";

function BootCard() {
  const { ref, inView } = useInView<HTMLDivElement>("-80px");
  const lines: Array<[React.ReactNode, number]> = [
    [<b key="0">$ docker run graft/graft</b>, 0],
    ["  postgres 18 ready", 300],
    ["  minio ready · bucket graft-assets", 600],
    ["  migrated · compiled · hardened", 900],
    [
      <span key="4">
        {"  serving :: fn + mcp + healthz "}
        <span className="t-mark">▮</span>
      </span>,
      1200,
    ],
  ];
  return (
    <div ref={ref} className={`runtime-card ${inView ? "in" : ""}`}>
      <h3>…or one container.</h3>
      <p>
        <code>graft serve</code> — the same stateless handlers behind a thin adapter. Postgres,
        MinIO, migrate, compile, harden, serve: one boot.
      </p>
      <pre>
        {lines.map(([node, delay], i) => (
          <span
            key={i}
            className="boot-line"
            style={{ "--boot-delay": `${delay}ms` } as React.CSSProperties}
          >
            {node}
            {"\n"}
          </span>
        ))}
      </pre>
    </div>
  );
}

export function RuntimeSection() {
  return (
    <div className="runtime-grid">
      <div className="runtime-card in">
        <h3>Embedded in your framework…</h3>
        <p>
          Next, Astro, SvelteKit — the SDKs mount the function + MCP handlers as routes. Identical
          bytes, your deploy.
        </p>
        <pre>
          <b>app/api/mcp/route.ts</b>
          {"\n"}
          <span className="t-mark">export</span>
          {" const POST = createGraftMcpHandler({ … })"}
          {"\n\n"}
          <b>app/api/fn/[name]/route.ts</b>
          {"\n"}
          <span className="t-mark">export</span>
          {" const POST = createFunctionsHandler({ … })"}
        </pre>
      </div>
      <BootCard />
    </div>
  );
}
