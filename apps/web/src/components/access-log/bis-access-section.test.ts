import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AccessLogCounts, AccessLogPage, AccessLogVisit } from "@bis/db";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { LocaleProvider } from "@/components/locale-provider";
import { encodeAccessCursor } from "@/lib/access-log/view";

/**
 * F-118 part 1 (plan Task 10, step 1; spec 6.1-6.3). `BisAccessSection` is an async Server Component,
 * so every leaf it reads through is mocked (same discipline as `components/team/team-section.test.ts`)
 * and the whole thing is awaited before `renderToStaticMarkup` + `LocaleProvider`
 * (`access-log-components.test.ts`'s own shape) renders what it resolved to.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const fx = vi.hoisted(() => ({
  dbForRequest: vi.fn(),
  serviceDb: vi.fn(),
  readAccessLogPage: vi.fn(),
  resolveAccessLogNames: vi.fn(),
  getPersonPrefs: vi.fn(),
  renderZone: vi.fn(),
}));

const account: { data: { timezone: string | null; language: string | null } | null; error: { message: string } | null } = {
  data: { timezone: "Pacific/Honolulu", language: null },
  error: null,
};
const DB = {
  tag: "rls",
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => account }) }) }),
};

vi.mock("@/lib/db", () => ({ dbForRequest: fx.dbForRequest }));
// serviceDb stubbed but never wired to anything real — if BisAccessSection ever called it, the spy
// below would see the call. Kept benign (returns DB) so a mutation probe fails on the ASSERTION, not
// on an unrelated crash from a half-built service client.
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readAccessLogPage: fx.readAccessLogPage,
  serviceDb: fx.serviceDb,
}));
vi.mock("@/lib/access-log/names", () => ({ resolveAccessLogNames: fx.resolveAccessLogNames }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: fx.getPersonPrefs }));
vi.mock("@/lib/zone", () => ({ renderZone: fx.renderZone }));

const { BisAccessSection } = await import("./bis-access-section");

const ZERO: AccessLogCounts = {
  contact: 0, group: 0, call: 0, conversation: 0, file: 0, form_answers: 0, customer_list_export: 0,
};
const visit = (id: string, overrides: Partial<AccessLogVisit> = {}): AccessLogVisit => ({
  id, actorName: "Dan Lopez", reason: "support", startedAt: "2026-10-29T12:00:00Z", endedAt: null,
  counts: ZERO, itemTotal: 0, items: [], ...overrides,
});
const PAGE3: AccessLogPage = {
  total: 3, hasOlder: true,
  visits: [
    visit("11111111-1111-4111-8111-111111111111"),
    visit("22222222-2222-4222-8222-222222222222"),
    visit("33333333-3333-4333-8333-333333333333"),
  ],
};
const EMPTY_NAMES = { contacts: new Map(), groups: new Map(), calls: new Map(), conversations: new Map(), documents: new Map(), forms: new Map() };
const HONOLULU = { zone: "Pacific/Honolulu", guessed: false, label: "Hawaii time" };

beforeEach(() => {
  account.data = { timezone: "Pacific/Honolulu", language: null };
  account.error = null;
  fx.dbForRequest.mockReset().mockResolvedValue(DB);
  fx.serviceDb.mockReset().mockReturnValue(DB);
  fx.readAccessLogPage.mockReset();
  fx.resolveAccessLogNames.mockReset().mockResolvedValue(EMPTY_NAMES);
  fx.getPersonPrefs.mockReset().mockResolvedValue({ language: null, theme: null });
  fx.renderZone.mockReset().mockResolvedValue(HONOLULU);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const section = (before?: string, isAgency = true) => BisAccessSection({ accountId: "A", isAgency, before });
const render = async (before?: string, isAgency = true) =>
  renderToStaticMarkup(createElement(
    LocaleProvider, { locale: "en" } as Parameters<typeof LocaleProvider>[0], await section(before, isAgency),
  ));
const navBlockOf = (html: string) => html.slice(html.indexOf("<nav"));

describe("BisAccessSection: loaded", () => {
  it("renders the real total, the rows through BisAccessList, and exactly one nav labelled 'BIS access pages' with only Older when there is no cursor (mutation: always render Newer -> FAILS)", async () => {
    fx.readAccessLogPage.mockResolvedValue(PAGE3);
    const html = await render();
    expect(renderedText(html)).toContain("3 visits");
    for (const v of PAGE3.visits) expect(html).toContain(`data-bis-access-visit="${v.id}"`);
    const navs = [...html.matchAll(/<nav\b[^>]*>/g)];
    expect(navs).toHaveLength(1);
    expect(navs[0]![0]).toContain('aria-label="BIS access pages"');
    const navBlock = navBlockOf(html);
    expect(navBlock).toContain(">Older<");
    expect(navBlock).not.toContain(">Newer<");
  });

  it("the Older link carries the LAST visit's own cursor, to this page's own route (mutation: use the first visit instead -> FAILS)", async () => {
    fx.readAccessLogPage.mockResolvedValue(PAGE3);
    const html = await render();
    const last = PAGE3.visits[PAGE3.visits.length - 1]!;
    const expectedHref = `/dashboard/accounts/A/team?${new URLSearchParams({ accessBefore: encodeAccessCursor(last) })}#bis-access`;
    expect(navBlockOf(html)).toContain(`href="${expectedHref}"`);
  });

  it("Newer renders only when a cursor was given, and drops it entirely; Older still renders beside it when hasOlder (mutation: carry the cursor forward on Newer's href -> FAILS)", async () => {
    const cursorVisit = visit("55555555-5555-4555-8555-555555555555", { startedAt: "2026-10-20T00:00:00Z" });
    const CURSOR = encodeAccessCursor(cursorVisit);
    fx.readAccessLogPage.mockResolvedValue(PAGE3);
    const html = await render(CURSOR);
    expect(fx.readAccessLogPage).toHaveBeenCalledWith(DB, "A", { startedAt: "2026-10-20T00:00:00Z", id: cursorVisit.id }, 20);
    const navBlock = navBlockOf(html);
    expect(navBlock).toContain(">Newer<");
    expect(navBlock).toContain('href="/dashboard/accounts/A/team#bis-access"');
    expect(navBlock).toContain(">Older<");
  });

  it("an unparseable cursor reads as page one: null, never the garbage string (mutation: pass `before` straight through -> FAILS)", async () => {
    fx.readAccessLogPage.mockResolvedValue(PAGE3);
    await section("garbage");
    expect(fx.readAccessLogPage).toHaveBeenCalledWith(DB, "A", null, 20);
  });
});

describe("BisAccessSection: empty", () => {
  it("a page with no visits ever (total 0) shows the empty sentence and nothing else interactive — no nav, no button, no link, and no name lookup at all (mutation: branch on visits.length instead of total -> FAILS)", async () => {
    fx.readAccessLogPage.mockResolvedValue({ total: 0, hasOlder: false, visits: [] } satisfies AccessLogPage);
    const html = await render();
    expect(renderedText(html)).toContain(m["accessLog.empty"]);
    expect(html).not.toMatch(/<nav|<button|<a /);
    expect(fx.resolveAccessLogNames).not.toHaveBeenCalled();
  });
});

describe("BisAccessSection: error", () => {
  it("readAccessLogPage rejecting renders BisAccessError instead of throwing (mutation: remove the surrounding try/catch -> FAILS, the promise rejects)", async () => {
    fx.readAccessLogPage.mockRejectedValue(new Error("rpc boom"));
    const html = await render();
    expect(html).toMatch(/role="alert"/);
    expect(renderedText(html)).toContain(m["accessLog.error"]);
  });

  it("a names-resolver rejection renders BisAccessError too (mutation: resolve names outside the try -> FAILS, the promise rejects)", async () => {
    fx.readAccessLogPage.mockResolvedValue(PAGE3);
    fx.resolveAccessLogNames.mockRejectedValue(new Error("names boom"));
    const html = await render();
    expect(html).toMatch(/role="alert"/);
  });
});

describe("BisAccessSection: Spanish", () => {
  it("a Spanish account renders '3 visitas' and the Spanish nothing-opened summary for a client reader (mutation: hardcode English -> FAILS)", async () => {
    account.data = { timezone: "Pacific/Honolulu", language: "es" };
    fx.readAccessLogPage.mockResolvedValue(PAGE3);
    const html = await render(undefined, false);
    const text = renderedText(html);
    expect(text).toContain("3 visitas");
    expect(text).toContain(m["accessLog.summary.nothing.es"]);
  });
});

describe("BisAccessSection: the zone", () => {
  it("renders a visit's `when` in the ACCOUNT's resolved zone (Honolulu), not UTC's calendar day (mutation: pass \"UTC\" to buildVisitRows's ctx.zone -> FAILS)", async () => {
    const v = visit("66666666-6666-4666-8666-666666666666", { startedAt: "2026-10-29T08:00:00Z" });
    fx.readAccessLogPage.mockResolvedValue({ total: 1, hasOlder: false, visits: [v] } satisfies AccessLogPage);
    const html = await render();
    const text = renderedText(html);
    expect(text).toContain("Oct 28, 2026");
    expect(text).not.toContain("Oct 29, 2026");
  });
});

describe("BisAccessSection: the reads", () => {
  it("every read goes through dbForRequest(); this component itself never calls serviceDb (mutation: read the account row with serviceDb() instead -> FAILS)", async () => {
    fx.readAccessLogPage.mockResolvedValue(PAGE3);
    await section();
    expect(fx.dbForRequest).toHaveBeenCalled();
    expect(fx.serviceDb).not.toHaveBeenCalled();
  });

  // A SECOND account: this component owns no authorization of its own (RLS on
  // `access_log_page`, read through `dbForRequest()`'s request-scoped client, is
  // what actually bounds a row to the agency or THIS account's Owner —
  // `access-log-schema.test.ts`'s "an Owner of A reads A's visits ... an Owner
  // of B ... read none of A's"). What Task 10 owns, and what this proves, is
  // that the component passes the account it was actually GIVEN straight
  // through everywhere, rather than a stale or hardcoded id (mutation: hardcode
  // accountId "A" into `base`/the read calls -> this FAILS for account "B").
  it("passes the GIVEN accountId through to every read and every href, never a hardcoded one (mutation: hardcode account A's id -> FAILS for account B)", async () => {
    fx.readAccessLogPage.mockResolvedValue(PAGE3);
    const html = renderToStaticMarkup(createElement(
      LocaleProvider, { locale: "en" } as Parameters<typeof LocaleProvider>[0],
      await BisAccessSection({ accountId: "B", isAgency: true, before: undefined }),
    ));
    expect(fx.readAccessLogPage).toHaveBeenCalledWith(DB, "B", null, 20);
    const last = PAGE3.visits[PAGE3.visits.length - 1]!;
    const expectedHref = `/dashboard/accounts/B/team?${new URLSearchParams({ accessBefore: encodeAccessCursor(last) })}#bis-access`;
    expect(navBlockOf(html)).toContain(`href="${expectedHref}"`);
    expect(html).not.toContain("/dashboard/accounts/A/");
  });
});

describe("BisAccessFrame: lang", () => {
  it("the section states its own language: lang=\"es\" for a Spanish account, lang=\"en\" otherwise (mutation: drop lang -> FAILS)", async () => {
    const { BisAccessFrame } = await import("./bis-access-frame");
    const frame = (locale: "en" | "es") => renderToStaticMarkup(createElement(
      LocaleProvider, { locale } as Parameters<typeof LocaleProvider>[0], createElement(BisAccessFrame, null),
    ));
    expect(frame("es")).toMatch(/<section[^>]*\blang="es"/);
    expect(frame("en")).toMatch(/<section[^>]*\blang="en"/);
  });
});
