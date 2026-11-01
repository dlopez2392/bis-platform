import { describe, it, expect, vi, beforeEach } from "vitest";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { encodeCursor } from "@/lib/cursor";
import { m } from "@/lib/messages";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
const authFixture = vi.hoisted(() => ({ isAgency: true }));
vi.mock("@/lib/auth", () => ({ requireNotTechnician: async () => ({ userId: "user_1", isAgency: authFixture.isAgency }) }));
// S-10 T5: this page now resolves its own locale (requestLocale + getPersonPrefs), same stub,
// same reason contacts/page.test.ts and calls/page.test.ts already use.
const prefsFixture = vi.hoisted(() => ({ language: null as "en" | "es" | null }));
vi.mock("@/lib/preferences/person-prefs", () => ({
  getPersonPrefs: async () => ({ language: prefsFixture.language, theme: null }),
}));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { timezone: "America/Chicago" }, error: null }) }) }) }) }),
}));
vi.mock("@/lib/zone", () => ({ renderZone: async () => ({ zone: "America/Chicago", label: "Central Time", guessed: false, source: "account" }) }));
// S-10 fix round I1: the REAL ZoneNote renders here. Mocked to null, the
// note's language was never on screen in this file, which is how the page
// shipped a Spanish table under an English "Times shown in" line.
const dbMocks = vi.hoisted(() => ({ listAutomationLog: vi.fn(), countAutomationUsage: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

const { default: ActivityPage } = await import("./page");

const USAGE = { textsSent: 1, emailsSent: 0, emailsFailed: 0, conversations: 0, callsHandled: 0, held: 0, skipped: 0, topHeldReason: null, topSkippedReason: null };
const ROW = { id: "00000000-0000-4000-8000-00000000000a", account_id: "a1", source: "concierge", channel: "ai", contact_id: null, subject_key: "conversation:1", status: "sent", reason: "", held_until: null, payload: {}, occurred_at: "2026-09-22T13:00:00.000Z", contact_name: null };

async function render(before?: string) {
  return renderToStaticMarkup(await ActivityPage({ params: Promise.resolve({ accountId: "a1" }), searchParams: Promise.resolve({ before }) }));
}

beforeEach(() => {
  dbMocks.listAutomationLog.mockReset().mockResolvedValue([]);
  dbMocks.countAutomationUsage.mockReset().mockResolvedValue(USAGE);
  authFixture.isAgency = true;
  prefsFixture.language = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the Activity page", () => {
  it("empty: the usage card AND the designed empty state, no table", async () => {
    const text = renderedText(await render());
    expect(text).toContain("What went out");
    expect(text).toContain("This month");
    expect(text).toContain("Nothing has gone out yet");
    expect(text).not.toContain("Older");
  });

  it("loaded: rows render and a full page gets an Older link carrying the LAST row's cursor (mutation: cursor from rows[0] → FAILS)", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ ...ROW, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, subject_key: `conversation:${i}` }));
    dbMocks.listAutomationLog.mockResolvedValue(rows);
    const html = await render();
    expect(html).toContain("Website assistant");
    expect(html).toContain(encodeCursor({ v: rows[24]!.occurred_at, id: rows[24]!.id }));
    expect(html).not.toContain(encodeCursor({ v: rows[0]!.occurred_at, id: rows[0]!.id }));
    expect(dbMocks.listAutomationLog).toHaveBeenCalledWith(expect.anything(), "a1", { limit: 25, before: undefined });
  });

  it("a valid cursor is passed through as two validated halves; junk reads as page one (mutation: pass raw `before` → FAILS)", async () => {
    const before = encodeCursor({ v: "2026-09-22T13:00:00.000Z", id: ROW.id });
    await render(before);
    expect(dbMocks.listAutomationLog).toHaveBeenLastCalledWith(expect.anything(), "a1", { limit: 25, before: { occurredAt: "2026-09-22T13:00:00.000Z", id: ROW.id } });
    await render("not-a-cursor");
    expect(dbMocks.listAutomationLog).toHaveBeenLastCalledWith(expect.anything(), "a1", { limit: 25, before: undefined });
    await render(encodeCursor({ v: "yesterday", id: ROW.id }));   // a uuid with a non-timestamp value
    expect(dbMocks.listAutomationLog).toHaveBeenLastCalledWith(expect.anything(), "a1", { limit: 25, before: undefined });
  });

  // D-068 (DESIGN.md rule 5): the empty state named what appears here but
  // offered no action that causes it. This page is BOTH audiences (its own
  // top comment) — a client reads it too — but only the agency can turn
  // automations on (nav-groups.ts: Automations is agency-only), so the
  // ACTION, not the page, is agency-only.
  it("the cold-start empty state offers the agency an action: a link to Automations (mutation: drop the action → FAILS)", async () => {
    const html = await render();
    expect(html).toMatch(new RegExp(`href="/dashboard/accounts/a1/automations"[^>]*>[^<]*Set up automations`));
  });

  // S-10 T5: the whole page used to be bare m[] reads, English regardless of the reader's own
  // choice (`prefs.language`).
  it("renders the title, usage card and empty state in Spanish for a Spanish-reading operator (mutation: hard-code English -> FAILS)", async () => {
    prefsFixture.language = "es";
    const text = renderedText(await render());
    expect(text).toContain(m["activity.title.es"]);
    expect(text).toContain(m["activity.usage.title.es"]);
    expect(text).toContain(m["activity.empty.title.es"]);
    expect(text).not.toContain("What went out");
  });

  it("names the zone in the reader's Spanish, through the real ZoneNote (mutation: drop locale from <ZoneNote> -> FAILS)", async () => {
    prefsFixture.language = "es";
    const text = renderedText(await render());
    expect(text).toContain(m["zone.note.es"].replace("{zone}", "Central Time"));
    expect(text).not.toContain(m["zone.note"].replace("{zone}", "Central Time"));
  });

  it("names this month in the reader's Spanish on the usage card (mutation: monthWindow without locale -> FAILS)", async () => {
    prefsFixture.language = "es";
    const text = renderedText(await render());
    const expected = new Intl.DateTimeFormat("es-US", { timeZone: "America/Chicago", month: "long", year: "numeric" }).format(new Date());
    const english = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "long", year: "numeric" }).format(new Date());
    expect(text).toContain(expected);
    expect(text).not.toContain(english);
  });

  // S-10 fix round M1: pseudo was resolved but never reached the title,
  // the empty state or a row's status pill.
  it("the QA pseudo-locale reaches the title, the empty state and a row's status pill (mutation: t(m, ...) / drop pseudo from <LogStatusPill> -> FAILS)", async () => {
    vi.stubEnv("BIS_I18N_QA", "1"); vi.stubEnv("VERCEL", "");
    try {
      const pseudoRender = async () => renderToStaticMarkup(await ActivityPage({ params: Promise.resolve({ accountId: "a1" }), searchParams: Promise.resolve({ locale: "pseudo" }) }));
      let text = renderedText(await pseudoRender());
      expect(text).toContain(pseudoLocale(m["activity.title"]));
      expect(text).toContain(pseudoLocale(m["activity.empty.title"]));
      dbMocks.listAutomationLog.mockResolvedValue([ROW]);
      text = renderedText(await pseudoRender());
      expect(text).toContain(pseudoLocale(m["activity.status.sent"]));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("gives a client reader no agency-only action — Automations is agency-only", async () => {
    authFixture.isAgency = false;
    const html = await render();
    expect(html).not.toContain("/automations");
  });

  // Minor, review round: the empty state's body copy said "for this
  // company" — correct agency voice (a third party describing the client),
  // wrong on the SAME page's client reading (the business owner reading
  // about their own business). No action is still fine for a client here
  // (Automations stays agency-managed) — only the SENTENCE needed a
  // second-person version, the same `body`/`clientBody` shape
  // branding.ts's panel-copy already uses.
  it("gives a client reader a client-voiced empty sentence, never \"for this company\"", async () => {
    authFixture.isAgency = false;
    const text = renderedText(await render());
    expect(text).toContain(m["activity.empty.clientBody"]);
    expect(text).not.toContain("for this company");
  });

  it("keeps the agency's own third-person sentence unchanged", async () => {
    authFixture.isAgency = true;
    const text = renderedText(await render());
    expect(text).toContain(m["activity.empty.body"]);
  });

  it("a cursored empty page is NOT the cold-start empty state: headers, a Newer link, no 'Nothing has gone out'", async () => {
    const text = renderedText(await render(encodeCursor({ v: "2026-09-22T13:00:00.000Z", id: ROW.id })));
    expect(text).not.toContain("Nothing has gone out yet");
    expect(text).toContain("Newer");
  });

  it("the two reads fail independently: usage error keeps the history; history error keeps the usage", async () => {
    dbMocks.countAutomationUsage.mockRejectedValue(new Error("down"));
    dbMocks.listAutomationLog.mockResolvedValue([ROW]);
    let text = renderedText(await render());
    expect(text).toContain("Couldn't load this month's numbers");
    expect(text).toContain("Website assistant");
    dbMocks.countAutomationUsage.mockResolvedValue(USAGE);
    dbMocks.listAutomationLog.mockRejectedValue(new Error("down"));
    text = renderedText(await render());
    expect(text).toContain("Couldn't load the history");
    expect(text).toContain("This month");
  });

  it("a history read failure on a CURSORED page still offers a way back to page one — the Notice must not take the pager with it (mutation: drop the Newer link beside the Notice → FAILS)", async () => {
    dbMocks.listAutomationLog.mockRejectedValue(new Error("down"));
    const cursored = renderedText(await render(encodeCursor({ v: "2026-09-22T13:00:00.000Z", id: ROW.id })));
    expect(cursored).toContain("Couldn't load the history");
    expect(cursored).toContain("Newer");

    // Page one has no "newer" to go back to — the link only appears with a cursor.
    const pageOne = renderedText(await render());
    expect(pageOne).toContain("Couldn't load the history");
    expect(pageOne).not.toContain("Newer");
  });

  it("reads this month in the ACCOUNT's zone, not the machine's (mutation: monthWindow(now, 'UTC') → FAILS in any zone but UTC)", async () => {
    await render();
    const [, , fromIso, toIso] = dbMocks.countAutomationUsage.mock.calls[0]!;
    // Chicago's month edges are 05:00Z or 06:00Z, never 00:00Z.
    expect(String(fromIso)).toMatch(/T0[56]:00:00\.000Z$/);
    expect(String(toIso)).toMatch(/T0[56]:00:00\.000Z$/);

    // `fromIso` is the CURRENT month's first day in Chicago, computed here
    // from `new Date()` at test-run time — not the page's own literal —
    // so a mutation that reads a stale/fixed epoch instead of `now` reds
    // this even in a month where the 05:00/06:00Z check above still holds.
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" }).formatToParts(new Date());
    const year = parts.find((p) => p.type === "year")!.value;
    const month = parts.find((p) => p.type === "month")!.value;
    expect(String(fromIso).startsWith(`${year}-${month}-01T`)).toBe(true);
  });
});
