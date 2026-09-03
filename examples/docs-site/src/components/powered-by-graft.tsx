/**
 * The public "Powered by Graft" mark — same bytes on the landing footer and
 * in the docs chrome. The SVGs are hosted at stable URLs so a README or
 * another site's footer can paste an <a><img></a> and import nothing.
 *
 * Phrase lock: "Powered by Graft". The site is dark-first; docs follow the
 * reader. Both variants ship so the right ink is on the paper.
 */
const HREF = "https://graft.page?utm_source=powered-by-graft";
const DARK_SRC = "/badges/powered-by-graft.svg";
const LIGHT_SRC = "/badges/powered-by-graft-light.svg";

export function PoweredByGraft() {
  return (
    <a href={HREF} className="powered-by-graft" aria-label="Powered by Graft">
      <img className="powered-by-graft-on-paper" src={DARK_SRC} alt="" width={180} height={24} />
      <img className="powered-by-graft-on-ink" src={LIGHT_SRC} alt="" width={180} height={24} />
    </a>
  );
}
