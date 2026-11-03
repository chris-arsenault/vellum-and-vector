import { Component, type ReactNode } from "react";

/** A failed panel shows its error in place; the editor and the open map stay mounted. A
 * deployment that replaced the site's code since the page opened makes a deferred module
 * unavailable, so that case asks for a save before reloading. */
export class PanelBoundary extends Component<
  { name: string; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="panel-failure">
        <p>
          {stalePageError(error)
            ? `${this.props.name} could not load because the site was updated after this page opened. Save the map, then reload the page.`
            : `${this.props.name} failed: ${error.message}`}
        </p>
        <button className="quiet" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}

export function stalePageError(error: Error) {
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
    error.message
  );
}
