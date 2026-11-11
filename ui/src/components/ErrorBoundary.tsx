import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  /**
   * When this value changes, a caught error is cleared and the children render
   * again. The layout passes the pathname, so a page that failed does not take
   * the navigation down with it: going to another page recovers (#1187).
   */
  resetKey?: unknown;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleDismiss = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh flex items-center justify-center bg-background p-6">
          <div className="max-w-md w-full bg-surface rounded-lg p-6 space-y-4 shadow-lg">
            <h1>Something went wrong</h1>
            <p className="text-body text-text-secondary">
              An unexpected error occurred. You can try dismissing this error or reloading the page.
            </p>
            {this.state.error && (
              <pre className="text-caption text-error bg-error/5 rounded-sm p-3 overflow-auto max-h-32 font-mono">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-3">
              <button
                onClick={this.handleDismiss}
                className="px-4 py-2 text-small font-medium rounded-sm bg-border-light text-text-secondary hover:bg-border hover:text-text transition-colors"
              >
                Dismiss
              </button>
              <button
                onClick={this.handleReload}
                className="px-4 py-2 text-small font-medium rounded-sm bg-primary-fill text-white hover:bg-primary-fill-hover transition-colors"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
