import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Denote rendering failed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="fatal-error" role="alert">
          <div className="welcome__mark">D</div>
          <h1>Denote could not render this workspace.</h1>
          <p>{this.state.error.message}</p>
          <button
            type="button"
            className="primary-button"
            onClick={() => window.location.reload()}
          >
            Reload Denote
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
