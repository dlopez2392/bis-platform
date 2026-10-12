"use client";

import { Component, Suspense, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { loggableError } from "@/lib/loggable-error";

type CoreProps = { fallback: (reset: () => void) => ReactNode; onReset: () => void; children: ReactNode };

/** The client half: catches a card's render-time throw and shows that card's error state. */
export class RecordCardBoundaryCore extends Component<CoreProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: unknown): void {
    console.error(`record page: a card failed to render: ${loggableError(error)}`);
  }
  reset = (): void => {
    this.props.onReset();
    this.setState({ failed: false });
  };
  render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.reset) : this.props.children;
  }
}

/**
 * One per card (spec C5, DESIGN.md "Record page": one card's fault never blanks the page).
 * React's server renderer does not run class error boundaries, so the Suspense is what keeps a
 * server-render throw inside this card: it renders `skeleton` there and the client retries, where
 * the core catches it. Verified on React 19.2.4 (plan, Global Constraints).
 */
export function RecordCardBoundary({ fallback, skeleton, children }: {
  // Optional only so createElement(RecordCardBoundary, props, child) type-checks (TS2769 on a
  // required children prop); ReactNode already admits undefined, so callers see no difference.
  fallback: (reset: () => void) => ReactNode; skeleton: ReactNode; children?: ReactNode;
}) {
  const router = useRouter();
  return (
    <RecordCardBoundaryCore fallback={fallback} onReset={() => router.refresh()}>
      <Suspense fallback={skeleton}>{children}</Suspense>
    </RecordCardBoundaryCore>
  );
}
