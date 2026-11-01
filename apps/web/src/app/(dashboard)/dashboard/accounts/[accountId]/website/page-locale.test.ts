// S-10 T2 (spec §3.1 row 13: "no locale on the page" today). A static
// source scan, the same shape dashboard/page-locale.test.ts uses for the
// account dashboard: this page's Supabase/branding reads make a full
// render-level test (mocking every table) disproportionate to a LOW task,
// and every literal this pins is a load-bearing call shape, not incidental
// text.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8",
);

describe("the Website page resolves its own locale (S-10 T2)", () => {
  it("reads the account's language and the person's own prefs, then calls requestLocale with userLanguage named (mutation: drop userLanguage → FAILS, request-locale-callers.test.ts also catches this repo-wide)", () => {
    expect(src).toMatch(/db\.from\("accounts"\)\.select\("language"\)\.eq\("id", accountId\)\.maybeSingle\(\)/);
    expect(src).toMatch(/requestLocale\(\{ account: accountLanguage, isOperator: isAgency, userLanguage: prefs\.language \}/);
  });

  it("passes the resolved locale into loadWebsiteState, not just the period (mutation: call loadWebsiteState with only 4 args → FAILS)", () => {
    expect(src).toMatch(/loadWebsiteState\(db, accountId, period, new Date\(\), locale\)/);
  });

  it("every m[...] read in this file is gone — PageHeader titles, the empty/waiting states and the period nav all route through tr.text() (mutation: leave any m[...] read → FAILS)", () => {
    expect(src).not.toMatch(/\bm\[/);
  });

  it("the page wraps its returned JSX in lang={locale} (mutation: drop it from any of the three return branches → FAILS)", () => {
    expect(src.match(/lang=\{locale\}/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
