import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import type { ScreenedCallRow } from "@bis/db";

vi.mock("@/lib/auth", () => ({ requireAgency: async () => ({ userId: "user_1" }) }));

let rows: ScreenedCallRow[] = [];
let total = 0;
vi.mock("@bis/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bis/db")>();
  return {
    ...actual, // `screenedClass` stays REAL — the mapping is under test.
    serviceDb: () => ({}),
    listScreenedCalls: async () => rows,
    countScreenedCalls: async () => total,
    listAccounts: async () => [{ id: "acct1", name: "Rio Roofing", timezone: "America/Chicago" }],
  };
});

const { default: ScreenedPage } = await import("./page");

function route(before?: string) {
  return { searchParams: Promise.resolve({ before }) };
}

function row(over: Partial<ScreenedCallRow> = {}): ScreenedCallRow {
  return {
    id: "s1", accountId: "acct1", calledE164: "+19565550100",
    callerE164: "+19565550111", reason: "repeat-spam",
    createdAt: "2026-09-18T14:30:00.000Z", ...over,
  };
}

describe("ScreenedPage", () => {
  beforeEach(() => { rows = []; total = 0; });

  it("states the REAL total, not the number of rows on screen (mutation: render rows.length -> FAILS)", async () => {
    rows = [row()];
    total = 412;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    expect(renderedText(html)).toContain(m["screened.total"].replace("{n}", "412"));
  });

  it("names the reason in WORDS (mutation: render the raw enum -> FAILS)", async () => {
    rows = [row({ reason: "not-live" })];
    total = 1;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    expect(renderedText(html)).toContain(m["screened.reason.not-live"]);
    expect(renderedText(html)).not.toContain("not-live");
  });

  it("renders a row with NO account without throwing (mutation: assume accountId is non-null -> FAILS)", async () => {
    rows = [row({ accountId: null, reason: "unknown-number" })];
    total = 1;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    expect(renderedText(html)).toContain(m["screened.reason.unknown-number"]);
  });

  it("says WITHHELD rather than blank for a withheld caller (mutation: render the null -> FAILS)", async () => {
    rows = [row({ callerE164: null })];
    total = 1;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    expect(renderedText(html)).toContain(m["screened.unknownCaller"]);
  });

  it("shows the empty state on a cold start (mutation: render the table at zero rows -> FAILS)", async () => {
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    expect(renderedText(html)).toContain(m["screened.empty.title"]);
  });

  it("renders exactly ONE pager, and only when the page is full (mutation: always render the pager -> FAILS)", async () => {
    rows = [row()];
    total = 1;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    const pagers = html.split(m["screened.older"]).length - 1;
    expect(pagers).toBe(0);
  });
});
