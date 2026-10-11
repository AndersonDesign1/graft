/**
 * What a person sees when a part of the Studio throws while rendering.
 *
 * Without a boundary React unmounts the whole tree and leaves a white page
 * with no way back but a reload the person has to think of. With one, the
 * error is named, the rest of the shell keeps working where it can, and the
 * way out is a button.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { IconWarning } from "./icons";

interface Props {
  children: ReactNode;
  /** "page" replaces the whole Studio; "view" replaces only the main panel. */
  scope: "page" | "view";
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Studio render error", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" data-scope={this.props.scope} role="alert">
        <IconWarning size={20} aria-hidden="true" />
        <h2>
          {this.props.scope === "page" ? "Studio stopped working" : "This view stopped working"}
        </h2>
        <p>
          Anything already saved is safe. Reload to try again. If it happens again, report the
          message below.
        </p>
        <code>{error.message}</code>
        <button
          type="button"
          className="btn"
          data-variant="primary"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}
