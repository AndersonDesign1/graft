/**
 * Skeletons shaped like the thing that is loading.
 *
 * "Loading…" tells you nothing about what is coming; a skeleton that matches
 * the real layout means the content arrives without the page jumping, and the
 * shape itself communicates what to expect. Each of these mirrors a specific
 * component's geometry — if that component's metrics change, these follow.
 */

function Bar({ w = "100%", h = "0.85rem" }: { w?: string; h?: string }) {
  return <span className="sk-bar" style={{ width: w, height: h }} />;
}

/** Sidebar content tree: collection row + nested document rows. */
export function TreeSkeleton({
  collections = 2,
  docs = 4,
}: {
  collections?: number;
  docs?: number;
}) {
  return (
    <div className="sk" aria-hidden="true">
      {Array.from({ length: collections }, (_, c) => (
        <div key={c} className="sk-tree-collection">
          <div className="sk-tree-row">
            <span className="sk-square" />
            <Bar w={`${45 + ((c * 17) % 25)}%`} />
          </div>
          <span className="sk-bar sk-syncbar" />
          <div className="sk-tree-children">
            {Array.from({ length: docs }, (_, d) => (
              <div key={d} className="sk-tree-row sk-tree-doc">
                <span className="sk-dot" />
                <Bar w={`${50 + ((d * 23) % 35)}%`} h="0.7rem" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The document editor: header, frontmatter fields, prose. */
export function DocumentSkeleton() {
  return (
    <div className="sk sk-doc" aria-hidden="true">
      <Bar w="35%" h="1.4rem" />
      <Bar w="20%" h="0.75rem" />
      <div className="sk-fields">
        {[0, 1, 2].map((i) => (
          <div key={i} className="sk-field">
            <Bar w="18%" h="0.65rem" />
            <span className="sk-input" />
          </div>
        ))}
      </div>
      <div className="sk-prose">
        {["92%", "88%", "70%", "95%", "60%", "84%", "45%"].map((w, i) => (
          <Bar key={i} w={w} />
        ))}
      </div>
    </div>
  );
}

/** A card's inner list — Overview panels, Settings blocks. */
export function ListSkeleton({ rows = 4, avatar = false }: { rows?: number; avatar?: boolean }) {
  return (
    <div className="sk" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk-row">
          {avatar ? <span className="sk-square" /> : null}
          <div className="sk-row-main">
            <Bar w={`${45 + ((i * 19) % 30)}%`} />
            <Bar w={`${30 + ((i * 13) % 25)}%`} h="0.65rem" />
          </div>
          <Bar w="3rem" h="0.65rem" />
        </div>
      ))}
    </div>
  );
}

/** Table views — History, Schema field tables. */
export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="sk sk-table" aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="sk-table-row">
          {Array.from({ length: cols }, (_, c) => (
            <Bar
              key={c}
              w={c === cols - 1 ? "4rem" : `${40 + (((r + c) * 11) % 45)}%`}
              h="0.75rem"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * A card's `mini-list` — the Overview panels. Narrower than ListSkeleton and
 * with the trailing timestamp column those rows actually have.
 */
export function MiniListSkeleton({ rows = 4 }: { rows?: number }) {
  // Borrows `mini-list`/`mini-row` rather than restating their metrics, so the
  // rows land at exactly the height the real ones will.
  return (
    <ul className="mini-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i}>
          <div className="mini-row" data-static="">
            <span className="sk-row-main">
              <Bar w={`${35 + ((i * 17) % 25)}%`} h="0.8rem" />
              <Bar w={`${45 + ((i * 13) % 20)}%`} h="0.65rem" />
            </span>
            <Bar w="3.5rem" h="0.7rem" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Health's stat row, at its final height before the numbers arrive. */
export function OverviewSkeleton() {
  return (
    <div className="stats" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="stat">
          <Bar w="5rem" h="0.8rem" />
          <Bar w="2.5rem" h="2.25rem" />
        </div>
      ))}
    </div>
  );
}

/** Stacked cards — Approvals, Schema, Branches. */
export function CardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="sk sk-cards" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sk-card">
          <div className="sk-row">
            <span className="sk-square" />
            <div className="sk-row-main">
              <Bar w="30%" />
              <Bar w="55%" h="0.65rem" />
            </div>
            <Bar w="4rem" h="1.1rem" />
          </div>
          <Bar w="100%" h="2.5rem" />
        </div>
      ))}
    </div>
  );
}
