import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "./proxy";

describe("proxy.ts — the unsubscribe surfaces stay public (spec §4.3, E2)", () => {
  it("only /dashboard is protected, so /u/… and /api/unsubscribe/… need no sign-in (mutation: protect \"/u(.*)\" or \"/api(.*)\" → an unsubscribe demands a login, FAILS)", () => {
    const src = readFileSync(fileURLToPath(new URL("./proxy.ts", import.meta.url)), "utf8");
    expect(src.match(/createRouteMatcher\((\[[^\]]*\])\)/)?.[1]).toBe('["/dashboard(.*)"]');
  });
});

/**
 * Evaluated with Next's OWN matcher (`unstable_doesMiddlewareMatch`), not a
 * hand-rolled regex, so these assert what production actually routes.
 */
const runs = (path: string) =>
  unstable_doesMiddlewareMatch({ config, url: `https://app.bis-rgv.com${path}` });

describe("proxy.ts — Clerk never runs on the public embeds (the 'This content is blocked' chat, 2026-10-05)", () => {
  it.each([
    "/c/b2swbbu52be8", "/c/b2swbbu52be8?locale=en&theme=dark",
    "/f/i994hbegzxng", "/b/7t36x3a3izen", "/u/sometoken", "/embed.js",
  ])("%s skips the proxy, so a signed-in visitor's cookie can never turn the framed page into a Clerk handshake redirect (mutation: drop c/ f/ b/ u/ from the matcher → FAILS)", (path) => {
    expect(runs(path)).toBe(false);
  });

  it.each([
    "/dashboard", "/dashboard/accounts/abc", "/sign-in", "/",
    "/api/concierge/b2swbbu52be8/turn", "/api/unsubscribe/tok", "/api/voice/texml",
  ])("%s still runs the proxy: the dashboard stays protected and every API keeps Clerk's request state (mutation: an over-broad exclusion → FAILS)", (path) => {
    expect(runs(path)).toBe(true);
  });

  it("only the four trees are carved out — a dashboard path that merely starts with one of their letters still runs", () => {
    for (const path of ["/calendar", "/forms", "/billing", "/users"]) expect(runs(path)).toBe(true);
  });
});
