import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";

interface Props {
  children: ReactNode;
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
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md w-full bg-surface rounded-[14px] border border-border p-6 space-y-4">
            <h1 className="text-[18px] font-semibold text-text">
              Something went wrong
            </h1>
            <p className="text-[14px] text-text-secondary">
              An unexpected error occurred. You can try dismissing this error or reloading the page.
            </p>
            {this.state.error && (
              <pre className="text-[12px] text-error bg-error/5 rounded-[6px] p-3 overflow-auto max-h-32 font-mono">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-3">
              <button
                onClick={this.handleDismiss}
                className="px-4 py-2 text-[13px] font-medium rounded-[6px] bg-border-light text-text-secondary hover:bg-border hover:text-text transition-colors"
              >
                Dismiss
              </button>
              <button
                onClick={this.handleReload}
                className="px-4 py-2 text-[13px] font-medium rounded-[6px] bg-primary text-white hover:bg-primary-hover transition-colors"
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
