import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import ts from "typescript";
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
    "/d/sometoken", "/d/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "/s/sometoken", "/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "/cal/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.ics",
  ])("%s skips the proxy, so a signed-in visitor's cookie can never turn the framed page into a Clerk handshake redirect (mutation: drop c/ f/ b/ u/ d/ s/ from the matcher → FAILS)", (path) => {
    expect(runs(path)).toBe(false);
  });

  it.each([
    "/dashboard", "/dashboard/accounts/abc", "/sign-in", "/",
    "/api/concierge/b2swbbu52be8/turn", "/api/unsubscribe/tok", "/api/voice/texml",
    "/docs", "/dashboard/d", "/api/d/sometoken/start",
    "/api/s/sometoken/download", "/settings", "/s",
    "/cal", "/cal/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  ])("%s still runs the proxy: the dashboard stays protected and every API keeps Clerk's request state (mutation: an over-broad exclusion → FAILS)", (path) => {
    expect(runs(path)).toBe(true);
  });

  it("only the six trees are carved out — a dashboard path that merely starts with one of their letters still runs", () => {
    for (const path of ["/calendar", "/forms", "/billing", "/users", "/dx", "/sx", "/support"]) expect(runs(path)).toBe(true);
  });
});

/**
 * F-118 part 1 (spec 3.2): the proxy hands the reason gate the in-account path the person asked for, in the
 * x-bis-path request header. clerkMiddleware cannot run under vitest, so this reads proxy.ts's real syntax
 * tree (comments are trivia and never become nodes): a CALL of accountPathOf, and a `.set(…)` whose first
 * argument is the identifier BIS_PATH_HEADER. The e2e deep link (Task 12) is the behavioural proof.
 */
describe("proxy.ts — the x-bis-path header (F-118 part 1, spec 3.2)", () => {
  it("calls accountPathOf and sets BIS_PATH_HEADER on the request headers (mutation: delete the headers.set line -> FAILS)", () => {
    const src = readFileSync(fileURLToPath(new URL("./proxy.ts", import.meta.url)), "utf8");
    const sf = ts.createSourceFile("proxy.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let callsAccountPathOf = false;
    let setsHeader = false;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee) && callee.text === "accountPathOf") callsAccountPathOf = true;
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === "set") {
          const first = node.arguments[0];
          if (first && ts.isIdentifier(first) && first.text === "BIS_PATH_HEADER") setsHeader = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect({ callsAccountPathOf, setsHeader }).toEqual({ callsAccountPathOf: true, setsHeader: true });
  });
});
