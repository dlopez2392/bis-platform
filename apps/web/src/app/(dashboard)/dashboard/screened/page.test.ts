import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import type { ScreenedCallRow } from "@bis/db";
import { formatCallTime } from "../accounts/[accountId]/calls/format";

vi.mock("@/lib/auth", () => ({ requireAgency: async () => ({ userId: "user_1" }) }));

// The agency's own zone, resolved ONCE by the page (lib/zone.ts) — mocked
// directly here rather than exercised through `serviceDb().from("agencies")`,
// which this file's `serviceDb: () => ({})` mock has no `.from()` for. Before
// this mock existed, that real path threw inside `readAgencyZone`'s try, was
// swallowed by its own catch, logged a `console.error` on every run, and fell
// back to UTC — so every test in this file that touched the agency zone was
// exercising a broken path, not the "resolved agency zone, never a bare UTC
// literal" behaviour the page's own comments promise. Picked to read on a
// different CLOCK HOUR than UTC for the fixture's `createdAt` below, so a
// regression back to UTC is a real, catchable failure rather than a
// coincidence of the two zones agreeing.
const AGENCY_ZONE = "America/Denver";
vi.mock("@/lib/zone", () => ({
  renderZone: async () => ({ zone: AGENCY_ZONE, guessed: true, label: AGENCY_ZONE, source: "agency" as const }),
}));

let rows: ScreenedCallRow[] = [];
let total = 0;
// The REAL cross-page misconfigured count (`countMisconfiguredScreenedCalls`)
// — deliberately a separate mock var from `rows`/`total`, never derived from
// them, so a regression back to a page-local `rows.filter(...)` recompute
// (screened-table.tsx's pre-fix shape) is a catchable mismatch rather than a
// coincidence of the fixture rows happening to agree with it.
let misconfiguredTotal = 0;
let accountsList: Array<{ id: string; name: string; timezone: string }> = [
  { id: "acct1", name: "Rio Roofing", timezone: "America/Chicago" },
];
vi.mock("@bis/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bis/db")>();
  return {
    ...actual, // `screenedClass` and `resolveZone` stay REAL — both are under test.
    serviceDb: () => ({}),
    listScreenedCalls: async () => rows,
    countScreenedCalls: async () => total,
    countMisconfiguredScreenedCalls: async () => misconfiguredTotal,
    listAccounts: async () => accountsList,
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
  beforeEach(() => {
    rows = [];
    total = 0;
    misconfiguredTotal = 0;
    accountsList = [{ id: "acct1", name: "Rio Roofing", timezone: "America/Chicago" }];
    // Re-spying an already-spied method keeps the same spy and its call
    // list; cleared here so a line logged by an earlier test cannot fail a
    // later one.
    vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
  });

  it("states the REAL total, not the number of rows on screen (mutation: render rows.length -> FAILS)", async () => {
    rows = [row()];
    total = 412;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    expect(renderedText(html)).toContain(m["screened.total"].replace("{n}", "412"));
  });

  // Finding 5: "1 refused calls" has no singular form. `toContain` on the
  // singular phrase alone cannot catch a regression to the plural template —
  // "1 refused call" is itself a SUBSTRING of "1 refused calls" — so this
  // also asserts the plural word is ABSENT, which only the singular branch
  // satisfies.
  it("uses the singular phrase for exactly one refused call, not a templated plural (mutation: always use the plural template -> FAILS)", async () => {
    rows = [row()];
    total = 1;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    const text = renderedText(html);
    expect(text).toContain(m["screened.totalOne"]);
    expect(text).not.toContain("refused calls");
  });

  // Second re-review finding — the misconfigured breakdown beside the total
  // shipped with ZERO coverage: a re-reviewer corrupted the classification
  // predicate and separately the `screened.misconfiguredOne` copy string and
  // the suite stayed green both times. `misconfiguredTotal` is the mocked
  // `countMisconfiguredScreenedCalls` — the REAL cross-page count — and is
  // set here to a number `rows` could never produce by local filtering (the
  // fixture `rows` below hold at most 2 misconfigured reasons), so a
  // regression back to `rows.filter((r) => screenedClass(r.reason) ===
  // "misconfigured").length` (the page-local shape the earlier fix wave
  // removed) renders "2 misconfigured", not "99 misconfigured", and this
  // test catches it.
  it("shows the REAL misconfigured total from its own cross-page count, not a recompute over the page's rows (mutation: revert to rows.filter((r) => screenedClass(r.reason) === \"misconfigured\").length -> FAILS)", async () => {
    rows = [
      row({ id: "s1", reason: "not-live" }), // misconfigured
      row({ id: "s2", reason: "no-profile" }), // misconfigured
      row({ id: "s3", reason: "over-cap" }), // screened
      row({ id: "s4", accountId: null, reason: "unknown-number" }), // unattributed
    ];
    total = 530;
    misconfiguredTotal = 99;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    expect(renderedText(html)).toContain("99 misconfigured");
  });

  it("uses the singular copy for exactly one misconfigured call (mutation: corrupt screened.misconfiguredOne's text -> FAILS)", async () => {
    rows = [row({ reason: "not-live" })];
    total = 1;
    misconfiguredTotal = 1;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    // Boundary-anchored, not `toContain`: `toContain("1 misconfigured")` is
    // satisfied by a corruption that merely APPENDS characters onto the copy
    // string — "1 misconfiguredXXX" still contains "1 misconfigured" as a
    // substring, so that assertion shape stays green even though the copy is
    // wrong. `\b…\b` requires a real word boundary on both sides; the "d" of
    // "…configured" butts straight up against an appended "X" (both word
    // characters), so no boundary exists there and the match fails, while the
    // real copy's "d" is followed by a tag (rendered as whitespace by
    // `renderedText`), which is a boundary. Deliberately still a hardcoded
    // literal, not `m["screened.misconfiguredOne"]` — reading the expected
    // value from the same catalogue the render reads would make a corrupted
    // copy string unfalsifiable.
    expect(renderedText(html)).toMatch(/\b1 misconfigured\b/);
  });

  it("uses the plural template for more than one misconfigured call (mutation: corrupt screened.misconfigured's text -> FAILS)", async () => {
    rows = [row({ id: "s1", reason: "not-live" }), row({ id: "s2", reason: "no-profile" })];
    total = 2;
    misconfiguredTotal = 7;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    // Same boundary-anchoring as the singular test above, and for the same
    // reason — `toContain("7 misconfigured")` cannot distinguish the real
    // copy from "7 misconfiguredXXX".
    expect(renderedText(html)).toMatch(/\b7 misconfigured\b/);
  });

  it("names the reason in WORDS (mutation: render the raw enum -> FAILS)", async () => {
    rows = [row({ reason: "not-live" })];
    total = 1;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    expect(renderedText(html)).toContain(m["screened.reason.not-live"]);
    expect(renderedText(html)).not.toContain("not-live");
  });

  it("renders a row with NO account without throwing, and shows the noAccount fallback (mutation: assume accountId is non-null -> FAILS)", async () => {
    rows = [row({ accountId: null, reason: "unknown-number" })];
    total = 1;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    expect(renderedText(html)).toContain(m["screened.reason.unknown-number"]);
    // Finding 3: the "—" fallback for an accountless row's Company cell was
    // untested — deleting it left every other assertion in this file green.
    expect(renderedText(html)).toContain(m["screened.noAccount"]);
  });

  // Finding 8: an accountless row (`unknown-number`) has no account zone of
  // its own to claim, so it takes the agency's — and it must be the
  // RESOLVED agency zone, never a bare "UTC" literal standing in for a read
  // that was never made.
  it("renders an accountless row in the AGENCY's zone, never UTC (mutation: fall back to 'UTC' instead of the resolved agency zone -> FAILS)", async () => {
    rows = [row({ accountId: null, reason: "unknown-number" })];
    total = 1;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    const text = renderedText(html);
    expect(text).toContain(formatCallTime(row().createdAt, AGENCY_ZONE));
    expect(text).not.toContain(formatCallTime(row().createdAt, "UTC"));
    expect(console.error).not.toHaveBeenCalled();
  });

  // Finding 1: `accounts.timezone` is free text, and a pre-#89 row can hold
  // a value `Intl` cannot format. This is a CROSS-ACCOUNT table, so handing
  // the raw column straight to `formatCallTime` crashes the render for
  // EVERY account, not just the broken one — proven by the reviewer with
  // `RangeError: Invalid time zone specified: Not/AZone`.
  it("resolves an unusable account timezone instead of crashing the render, and the row still carries a real date (mutation: hand the raw accounts.timezone to formatCallTime -> throws RangeError: Invalid time zone specified: Not/AZone)", async () => {
    accountsList = [{ id: "acct1", name: "Rio Roofing", timezone: "Not/AZone" }];
    rows = [row()]; // accountId: "acct1"
    total = 1;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    // `resolveZone` is total by construction: an unusable account zone
    // falls back to the agency's own resolved zone, not a thrown error and
    // not a blank cell.
    expect(renderedText(html)).toContain(formatCallTime(row().createdAt, AGENCY_ZONE));
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

  // Finding 2: the pager's POSITIVE case was never pinned — no test ever
  // built a full page, so a duplicated `<Link>` inside the `olderHref`
  // branch left all six original tests green.
  it("renders exactly ONE pager when a FULL page comes back (mutation: duplicate the pager Link -> FAILS)", async () => {
    rows = Array.from({ length: 50 }, (_, i) => row({ id: `s${i}` }));
    total = 50;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    const pagers = html.split(m["screened.older"]).length - 1;
    expect(pagers).toBe(1);
  });
});
