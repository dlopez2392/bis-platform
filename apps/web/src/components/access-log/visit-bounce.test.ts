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

// A Link would be a SOFT navigation, the one that replays the cached redirect; the fallback must never be one.
vi.mock("next/link", () => ({ default: () => "SOFT-LINK" }));

describe("VisitBounce", () => {
  const html = renderToStaticMarkup(createElement(VisitBounce, {
    target: "/dashboard/accounts/a/tasks", label: "Opening the account", continueLabel: "Continue",
  }));

  it("carries its target and announces itself to a screen reader, as a status, with no spinner (rule 7) (mutation: drop the label or the target -> FAILS)", () => {
    expect(html).toContain('data-bounce-to="/dashboard/accounts/a/tasks"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Opening the account");
    expect(html).not.toMatch(/animate-spin|spinner/i);
  });

  // #308 follow-up M1: if the hard navigation never happens (a blocked script, a slow device), the person is
  // not stuck on a skeleton: a visible link to the same target, a plain anchor so following it is a hard
  // navigation too.
  it("shows a visible Continue link to the same target, a plain <a>, never a next/link (mutation: no link, or a Link -> FAILS)", () => {
    expect(html).toMatch(/<a[^>]*href="\/dashboard\/accounts\/a\/tasks"[^>]*>Continue<\/a>/);
    expect(html).not.toContain("SOFT-LINK");
    const anchor = /<a[^>]*>/.exec(html)![0];
    expect(anchor).not.toMatch(/sr-only|hidden/);
  });
});
