"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
            minHeight: 200,
            textAlign: "center",
            color: "#999",
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 12 }}>&#x26A0;</div>
          <div style={{ fontSize: 14, marginBottom: 8, color: "#e5e5e5" }}>
            Something went wrong
          </div>
          <div style={{ fontSize: 12, marginBottom: 16, maxWidth: 400 }}>
            {this.state.error?.message || "An unexpected error occurred."}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #333",
              background: "#1a1a1a",
              color: "#e5e5e5",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
