import "@fontsource/instrument-serif";
import "@fontsource-variable/instrument-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles/tokens.css";
import "./styles/palette.css";
import "./styles/roles.css";
import "./styles/studio.css";

import { createRoot } from "react-dom/client";
import { StudioApp } from "./app";
import { currentBranch } from "./lib/route";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<StudioApp branch={currentBranch()} />);
}
