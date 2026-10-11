// IBM Plex, the face of every Graft surface: Sans for what a person reads,
// Mono for identifiers. The same weights the docs load (400, 500, 600).
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/400-italic.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
// Crepe's structural CSS only — block handles, the slash menu, the link
// tooltip. Its visual themes (nord/frame/classic) are deliberately not
// imported: those bring a second palette and typography, and parts.css points
// the editor at our tokens instead.
import "@milkdown/crepe/theme/common/style.css";

import "@usegraft/tokens/tokens.css";
import "./styles/roles.css";
import "./styles/type.css";
import "./styles/studio.css";
import "./styles/parts.css";
import "./styles/editor.css";

import { createRoot } from "react-dom/client";
import { StudioApp } from "./app";
import { currentBranch } from "./lib/route";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<StudioApp branch={currentBranch()} />);
}
