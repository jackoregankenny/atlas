import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: (err: Error, reset: () => void) => ReactNode;
  /** Bumping this key resets the boundary so the user can try again. */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <div className="error-fallback">
          <div className="error-fallback-title">Something broke</div>
          <div className="error-fallback-msg">{this.state.error.message}</div>
          <button onClick={this.reset}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
