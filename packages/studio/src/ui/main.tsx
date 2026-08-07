// Geist over the docs site's Instrument Serif/Sans: this is a dashboard, not
// an editorial page. Geist is drawn for dense UI (tight vertical metrics,
// unambiguous 1/l/I, real tabular figures) and is the face behind the Vercel
// reference this design follows.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/tokens.css";
import "./styles/palette.css";
import "./styles/roles.css";
import "./styles/type.css";
import "./styles/studio.css";

import { createRoot } from "react-dom/client";
import { StudioApp } from "./app";
import { currentBranch } from "./lib/route";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<StudioApp branch={currentBranch()} />);
}
