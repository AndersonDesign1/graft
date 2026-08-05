"use client";

/**
 * Hover a frontmatter field, see the inferred type light up (and vice
 * versa) — `DocumentData<typeof pages>` shown, not claimed. Pure state +
 * CSS; keyboard-safe (focus works like hover).
 */
import { useState } from "react";

type Line = { key: string | null; jsx: React.ReactNode };

const YAML: Line[] = [
  { key: null, jsx: <span className="tk-dim">--- # content/pages/home.mdx</span> },
  {
    key: "title",
    jsx: (
      <>
        <span className="tk-key">title</span>: <span className="tk-str">Graft</span>
      </>
    ),
  },
  {
    key: "tagline",
    jsx: (
      <>
        <span className="tk-key">tagline</span>:{" "}
        <span className="tk-str">Content is code.</span>
      </>
    ),
  },
  {
    key: "image",
    jsx: (
      <>
        <span className="tk-key">image</span>: {"{ "}
        <span className="tk-key">key</span>: <span className="tk-str">pages/home/hero.svg</span>
        {" }"}
      </>
    ),
  },
  {
    key: "faqs",
    jsx: (
      <>
        <span className="tk-key">faqs</span>: <span className="tk-dim">[ …2 items ]</span>
      </>
    ),
  },
  { key: null, jsx: <span className="tk-dim">---</span> },
];

const TYPES: Line[] = [
  {
    key: null,
    jsx: (
      <>
        <span className="tk-dim">{"// inferred — no codegen, no build step"}</span>
      </>
    ),
  },
  {
    key: null,
    jsx: (
      <>
        <span className="tk-type">type</span> <span className="tk-key">Home</span> ={" "}
        <span className="tk-type">DocumentData</span>&lt;
        <span className="tk-type">typeof</span> pages&gt; = {"{"}
      </>
    ),
  },
  {
    key: "title",
    jsx: (
      <>
        {"  "}
        <span className="tk-key">title</span>: <span className="tk-type">string</span>;
      </>
    ),
  },
  {
    key: "tagline",
    jsx: (
      <>
        {"  "}
        <span className="tk-key">tagline</span>?: <span className="tk-type">string</span>;
      </>
    ),
  },
  {
    key: "image",
    jsx: (
      <>
        {"  "}
        <span className="tk-key">image</span>?: <span className="tk-type">AssetRef</span>;
      </>
    ),
  },
  {
    key: "faqs",
    jsx: (
      <>
        {"  "}
        <span className="tk-key">faqs</span>?: {"{ "}
        <span className="tk-key">question</span>: <span className="tk-type">string</span>;{" "}
        <span className="tk-key">answer</span>: <span className="tk-type">string</span>
        {" }[];"}
      </>
    ),
  },
  { key: null, jsx: <>{"}"}</> },
];

function Pane({
  title,
  lines,
  hot,
  setHot,
}: {
  title: string;
  lines: Line[];
  hot: string | null;
  setHot: (k: string | null) => void;
}) {
  return (
    <div className="typed-pane">
      <div className="typed-pane-title">{title}</div>
      <pre>
        {lines.map((line, i) => (
          <span
            key={i}
            className="typed-line"
            data-hot={line.key !== null && line.key === hot}
            tabIndex={line.key ? 0 : undefined}
            onMouseEnter={line.key ? () => setHot(line.key) : undefined}
            onMouseLeave={line.key ? () => setHot(null) : undefined}
            onFocus={line.key ? () => setHot(line.key) : undefined}
            onBlur={line.key ? () => setHot(null) : undefined}
          >
            {line.jsx}
          </span>
        ))}
      </pre>
    </div>
  );
}

export function TypedReads() {
  const [hot, setHot] = useState<string | null>(null);
  return (
    <>
      <div className="typed-panes">
        <Pane title="what you write" lines={YAML} hot={hot} setHot={setHot} />
        <Pane title="what the SDK knows" lines={TYPES} hot={hot} setHot={setHot} />
      </div>
      <p className="typed-hint">
        <b>hover a field</b>. One Zod schema; compiler, SDKs, and MCP all infer from it.
      </p>
    </>
  );
}
