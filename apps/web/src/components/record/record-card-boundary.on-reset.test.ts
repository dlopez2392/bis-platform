import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const { RecordCardBoundary } = await import("./record-card-boundary");

type CoreEl = ReactElement<{ onReset: () => void }>;
const fallback = () => null;

describe("RecordCardBoundary's onReset (S-03 part 3: a section inside an overlay retries itself, never the page behind it)", () => {
  beforeEach(() => refresh.mockReset());

  it("a given onReset is what the core calls, and the router is not refreshed (mutation: ignore onReset -> FAILS)", () => {
    const onReset = vi.fn();
    const el = RecordCardBoundary({ fallback, skeleton: null, onReset }) as CoreEl;
    el.props.onReset();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("without one, today's refresh (mutation: drop the default -> FAILS)", () => {
    const el = RecordCardBoundary({ fallback, skeleton: null }) as CoreEl;
    el.props.onReset();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
