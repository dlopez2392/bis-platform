import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * #308 follow-up M1: the bounce's effect is the whole point of the component, and `renderToStaticMarkup`
 * never runs effects, so visit-bounce.test.ts could not see it. No DOM renderer in apps/web: React's
 * `useEffect` is answered here by running the effect at once (add-relationship-dialog.test.ts's idiom of
 * answering hooks in place), so rendering the component on the server runs its navigation.
 */
const effects = vi.hoisted(() => ({ ran: 0 }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useEffect: (fn: () => void) => { effects.ran++; fn(); } };
});

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { VisitBounce } = await import("./visit-bounce");

afterEach(() => {
  vi.unstubAllGlobals();
  effects.ran = 0;
});

describe("VisitBounce — the effect", () => {
  it("rendering it hard-navigates to its target, once (mutation: the effect no longer calls bounceIntoAccount -> FAILS)", () => {
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { replace } });
    renderToStaticMarkup(createElement(VisitBounce, {
      target: "/dashboard/accounts/a/tasks", label: "Opening the account", continueLabel: "Continue",
    }));
    expect(effects.ran).toBe(1);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/dashboard/accounts/a/tasks");
  });
});
