'use client';
import { Component, ReactNode } from 'react';

interface Props { children: ReactNode; title?: string; }
interface State { error: string | null; }

export default class ChartErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(err: unknown): State {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-border bg-secondary/30 px-4 py-3 text-xs text-muted-foreground">
          {this.props.title && <span className="font-medium mr-1">{this.props.title}:</span>}
          Chart unavailable — {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}
