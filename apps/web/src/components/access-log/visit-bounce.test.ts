import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bounceIntoAccount, VisitBounce } from "./visit-bounce";

/**
 * The router-cache loop's second guard (2026-10-30). A visit started in another tab leaves this tab's
 * client router cache holding prefetched "go to the chooser" redirects for the account's routes for 300 s.
 * `router.refresh()` clears the client cache for the CURRENT route only (Next 16.3 use-router.md), so a
 * soft `router.replace` into the account would replay a cached redirect. A hard navigation drops the whole
 * client cache, so the bounce uses `window.location.replace`.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bounceIntoAccount", () => {
  it("replaces the page with a HARD navigation to the target, so no cached client redirect can replay (mutation: router.replace / location.assign / a no-op -> FAILS)", () => {
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { replace } });
    bounceIntoAccount("/dashboard/accounts/a/tasks");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/dashboard/accounts/a/tasks");
  });
});

describe("VisitBounce", () => {
  const html = renderToStaticMarkup(createElement(VisitBounce, { target: "/dashboard/accounts/a/tasks", label: "Opening the account" }));

  it("carries its target and announces itself to a screen reader, as a status, with no spinner (rule 7) (mutation: drop the label or the target -> FAILS)", () => {
    expect(html).toContain('data-bounce-to="/dashboard/accounts/a/tasks"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Opening the account");
    expect(html).not.toMatch(/animate-spin|spinner/i);
  });
});
