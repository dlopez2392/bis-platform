import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * F-006 part 1 (plan Task 11 fix round, finding #6): `replacePeek` swaps the `?peek=` id in place —
 * `history.replaceState`, never `pushState` — so a merged-away `?peek=` can re-key to the kept
 * record's id without adding a Back-button stop.
 */
const { replacePeek } = await import("./use-peek");

afterEach(() => { vi.unstubAllGlobals(); });

describe("replacePeek", () => {
  it("replaces the current entry's ?peek=, never pushes a new one (mutation: pushState instead -> FAILS)", () => {
    const replaceState = vi.fn();
    const pushState = vi.fn();
    vi.stubGlobal("window", {
      location: { href: "https://app.example/dashboard/accounts/a1/contacts?peek=old1&q=x" },
      history: { replaceState, pushState },
    });
    replacePeek("kept9");
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledTimes(1);
    const [data, , url] = replaceState.mock.calls[0]!;
    expect(data).toBeNull();
    expect(String(url)).toBe("https://app.example/dashboard/accounts/a1/contacts?peek=kept9&q=x");
  });
});
