import { createRoot } from "react-dom/client";
import { StudioApp } from "../panels";

const params = new URLSearchParams(window.location.search);
const branch = params.get("branch")?.trim() || "main";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<StudioApp branch={branch} />);
}
