import { RefreshButton } from "./refresh-button";

// Mounts the Server Action so Next registers it. The smoke test calls it over
// HTTP the way the button does.
export default function ActionPage() {
  return <RefreshButton />;
}
