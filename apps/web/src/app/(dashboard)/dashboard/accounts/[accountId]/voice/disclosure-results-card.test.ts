import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@bis/db";
import { makeTr } from "@/lib/record/copy";
import { renderedText } from "@/lib/rendered-text";

const fx = vi.hoisted(() => ({
  fail: false,
  seenDb: null as unknown,
  results: {
    said: { counted: 5, booked: 2, abandoned: 1, askedPerson: 1 },
    didnt: { counted: 3, booked: 0, abandoned: 3, askedPerson: 0 },
    notCounted: 6,
  },
}));

// importOriginal-based (not the Global Constraints' flagged bare-factory shape), overriding only what
// this card reads. NO serviceDb here: the card never gets a client of its own (in-account-service-reads
// .test.ts) — page.tsx hands it the one it already holds behind requireAgencyOnlyAccountAccess.
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDisclosureResults: async (db: unknown, accountId: string) => {
    fx.seenDb = db;
    if (fx.fail) throw new Error("lookup for owner@example.com failed");
    return { ...fx.results, accountId };
  },
}));

const { DisclosureResultsCard } = await import("./disclosure-results-card");

const FAKE_DB = { tag: "the page's own client" } as unknown as SupabaseClient;
const RETRY = "/dashboard/accounts/acct-1/voice";

beforeEach(() => {
  fx.fail = false;
  fx.seenDb = null;
});

describe("DisclosureResultsCard", () => {
  it("reads through the client it is handed, and renders the loaded view from it (mutation: read through serviceDb() -> FAILS)", async () => {
    const el = await DisclosureResultsCard({ db: FAKE_DB, accountId: "acct-1", setting: "trial", retryHref: RETRY, tr: makeTr("en") });
    expect(fx.seenDb).toBe(FAKE_DB);
    const html = renderToStaticMarkup(el);
    expect(renderedText(html)).toContain("Saying it's an AI: how calls went");
    expect(html).toMatch(/data-half="said"[\s\S]*?data-cell="counted"[^>]*>5</);
    expect(html).toMatch(/data-half="didnt"[\s\S]*?data-cell="counted"[^>]*>3</);
  });

  it("hands the stored setting through to the empty state (mutation: hard-code setting=\"trial\" in the card -> FAILS)", async () => {
    fx.results = { said: { counted: 0, booked: 0, abandoned: 0, askedPerson: 0 }, didnt: { counted: 0, booked: 0, abandoned: 0, askedPerson: 0 }, notCounted: 2 };
    try {
      const el = await DisclosureResultsCard({ db: FAKE_DB, accountId: "acct-1", setting: "on", retryHref: RETRY, tr: makeTr("en") });
      const text = renderedText(renderToStaticMarkup(el));
      expect(text).toContain("Choose Trial above and save.");
      expect(text).toContain("2 calls not counted (spam, or outside the trial)");
    } finally {
      fx.results = {
        said: { counted: 5, booked: 2, abandoned: 1, askedPerson: 1 },
        didnt: { counted: 3, booked: 0, abandoned: 3, askedPerson: 0 },
        notCounted: 6,
      };
    }
  });

  it("a failed read never rethrows: it logs the account id and the redacted error, nothing else (mutations: rethrow in the catch, or log String(e) -> FAIL)", async () => {
    fx.fail = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = await DisclosureResultsCard({ db: FAKE_DB, accountId: "acct-1", setting: "trial", retryHref: RETRY, tr: makeTr("en") });
    const html = renderToStaticMarkup(el);
    expect(renderedText(html)).toContain("Couldn't load how calls went.");
    expect(errSpy).toHaveBeenCalledOnce();
    expect(errSpy.mock.calls[0]).toEqual([
      "voice: disclosure results read failed for account acct-1: Error: lookup for [email] failed",
    ]);
    errSpy.mockRestore();
  });
});
