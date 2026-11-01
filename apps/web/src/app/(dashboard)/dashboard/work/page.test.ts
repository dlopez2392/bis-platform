import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgencyWorkRow, BillingAlert, BillingAlerts, Proposal } from "@bis/db";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { makeTr } from "@/lib/record/copy";

// This is the first screen whose whole purpose is to span every account
// (task-6-brief.md), and the boundary — requireAgency() on the very first
// line, before any read — is the point of it. The mock below is a plain
// vi.fn() rather than a fixed resolved value, specifically so the first
// test can make it REJECT and prove nothing downstream runs.
const requireAgencyMock = vi.fn(async () => ({ userId: "user_1" }));
vi.mock("@/lib/auth", () => ({
  requireAgency: () => requireAgencyMock(),
}));

const listAgencyWorkMock = vi.fn(async (): Promise<AgencyWorkRow[]> => []);
// The banner's own read — defaults to 0 (no banner) so every pre-existing
// case below is unaffected by its addition. Real signature read from
// packages/db/src/screened-calls.ts: `(db, sinceIso) => Promise<number>`.
const countLinesTurningCallersAwayMock = vi.fn<
  (db: unknown, sinceIso: string) => Promise<number>
>(async () => 0);
// Work Queue Task 10's own read — defaults to [] (no suggestions section)
// so every pre-existing case below is unaffected by its addition. Real
// signature read from packages/db/src/proposals.ts.
type AgencyRow = Proposal & { brandName: string; timezone: string; accountCapped: boolean };
const listPendingProposalsForAgencyMock = vi.fn(async (..._a: unknown[]): Promise<AgencyRow[]> => []);
// The stale-usage banner's read (client billing) — defaults to [] (no
// banner) so every case above is unaffected. Real signature:
// packages/db/src/usage.ts, `(db, now) => Promise<string[]>`.
const listAccountsWithStaleUsageMock = vi.fn<(db: unknown, now: Date) => Promise<string[]>>(async () => []);
// Task 11's own read (plan G13) — defaults to [] (no banner) so every case
// above is unaffected. Real signature: packages/db/src/account-billing.ts,
// `(db, now, opts: { enforced: boolean }) => Promise<BillingAlerts>`.
const NO_ALERTS: BillingAlerts = { alerts: [], reconciliationUnchecked: false };
const listBillingAlertsMock = vi.fn<(db: unknown, now: Date, opts: { enforced: boolean }) => Promise<BillingAlerts>>(async () => NO_ALERTS);
/**
 * The service client, as a recording fake (item 8b-2): every `from(table)` logs its `.eq`/`.in`/`.limit`
 * filters and answers the table's rows FILTERED by them, so a read that drops a filter really draws another
 * account's row. The page's own reads (the contacts batch) and the cards' context read
 * (readAgencySuggestionContext: voice_profiles, calls, and per stage-account opportunities and
 * pipeline_stages) all go through it. A table in `fake.fail` answers an error.
 */
type FakeRow = Record<string, unknown>;
type FakeQuery = { table: string; eq: [string, unknown][]; in: [string, unknown[]][]; limit: number | null };
const fake = { tables: {} as Record<string, FakeRow[]>, fail: new Set<string>(), log: [] as FakeQuery[] };
const readsOf = (table: string) => fake.log.filter((q) => q.table === table);
const FAKE_DB = {
  from(table: string) {
    const entry: FakeQuery = { table, eq: [], in: [], limit: null };
    fake.log.push(entry);
    const run = () => {
      if (fake.fail.has(table)) return { data: null, error: { message: `permission denied for table ${table}` } };
      const rows = (fake.tables[table] ?? [])
        .filter((r) => entry.eq.every(([c, v]) => r[c] === v) && entry.in.every(([c, vs]) => vs.includes(r[c])));
      return { data: entry.limit === null ? rows : rows.slice(0, entry.limit), error: null };
    };
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => { entry.eq.push([c, v]); return q; },
      in: (c: string, vs: unknown[]) => { entry.in.push([c, vs]); return q; },
      limit: (n: number) => { entry.limit = n; return q; },
      maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko),
    };
    return q;
  },
};
const prefsMock = vi.fn(async () => ({ language: null as "en" | "es" | null, theme: null }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: () => prefsMock() }));
// The section's Retry refreshes through the app router, which a static render has not mounted.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock("@bis/db", async () => ({
  // Item 8b-2: each card is built in its account's zone through the REAL renderZone (lib/zone.ts), whose two
  // pure helpers come from the real package; every read below stays mocked.
  isUsableZone: (await vi.importActual<typeof import("@bis/db")>("@bis/db")).isUsableZone,
  resolveZone: (await vi.importActual<typeof import("@bis/db")>("@bis/db")).resolveZone,
  serviceDb: () => FAKE_DB,
  listAgencyWork: () => listAgencyWorkMock(),
  countLinesTurningCallersAway: (db: unknown, sinceIso: string) =>
    countLinesTurningCallersAwayMock(db, sinceIso),
  listPendingProposalsForAgency: (...a: unknown[]) => listPendingProposalsForAgencyMock(...a),
  listAccountsWithStaleUsage: (db: unknown, now: Date) => listAccountsWithStaleUsageMock(db, now),
  listBillingAlerts: (db: unknown, now: Date, opts: { enforced: boolean }) => listBillingAlertsMock(db, now, opts),
}));

function row(overrides: Partial<AgencyWorkRow> = {}): AgencyWorkRow {
  return {
    id: "task:1", source: "task", accountId: "acct-a", contactId: null,
    title: "Call back", dueAt: null, occurredAt: "2026-09-01T00:00:00Z",
    brandName: "Rio Roofing", timezone: "America/Chicago", suppressed: false,
    ...overrides,
  };
}

function proposal(overrides: Partial<AgencyRow> = {}): AgencyRow {
  return {
    id: "prop-1", accountId: "acct-a", callId: "call-1", contactId: null,
    kind: "task", payload: { title: "Call back", dueAt: null },
    evidence: "the caller asked for a callback", status: "pending",
    decidedAt: null, decidedBy: null, createdAt: "2026-09-01T00:00:00Z",
    source: "call", evidenceRef: {}, evidenceLang: "en", expiredReason: null, appliedPayload: null, appliedRef: null, undoneAt: null, undoneBy: null, expiresAt: "2099-10-01T00:00:00Z",
    brandName: "Rio Roofing", timezone: "America/Chicago", accountCapped: false,
    ...overrides,
  } as AgencyRow;
}
const T = makeTr("en");
const cardsIn = (html: string) => [...html.matchAll(/<article[^>]*data-suggestion="([^"]+)"/g)].map((x) => x[1]);

describe("AgencyWorkPage", () => {
  // Hoisted out of every test: `import("./page")` cold-loads the whole
  // module graph (page.tsx's Next conventions, @bis/db, agency-work-list,
  // pipeline-stage types) exactly once — vitest's module cache serves every
  // later `import("./page")` from memory. In isolation that first load is
  // fast, but under a full-suite run on a contended machine it has exceeded
  // vitest's 5s default per-test timeout — not because the module is slow,
  // but because whichever test happens to run first was paying for it. Paid
  // for here instead, in `beforeAll`, with its own explicit timeout, so no
  // single `it()` carries a cost that belongs to the file as a whole.
  let AgencyWorkPage: typeof import("./page").default;
  beforeAll(async () => {
    ({ default: AgencyWorkPage } = await import("./page"));
  }, 15000);

  beforeEach(() => {
    requireAgencyMock.mockReset().mockImplementation(async () => ({ userId: "user_1" }));
    listAgencyWorkMock.mockReset().mockResolvedValue([]);
    countLinesTurningCallersAwayMock.mockReset().mockResolvedValue(0);
    listPendingProposalsForAgencyMock.mockReset().mockResolvedValue([]);
    listAccountsWithStaleUsageMock.mockReset().mockResolvedValue([]);
    listBillingAlertsMock.mockReset().mockResolvedValue(NO_ALERTS);
    vi.unstubAllEnvs();
    fake.tables = {};
    fake.fail.clear();
    fake.log.length = 0;
    prefsMock.mockReset().mockResolvedValue({ language: null, theme: null });
  });

  // Fix-wave Important 2 (task-11-brief): this page issues THREE serviceDb
  // reads, not one — `listAgencyWork`, `listPendingProposalsForAgency` (every
  // account's pending proposals, `evidence` and all — a verbatim quote from a
  // caller on someone else's line) and the `pipeline_stages` lookup. The
  // original version of this test named only `listAgencyWork`, so hoisting
  // the proposals read above `await requireAgency()` (preserving its own
  // `.catch` and concurrency) left this test, and all 45 of its neighbours,
  // green — PROVED live, see this task's own report.
  it("guards before any read — a rejected agency check never reaches listAgencyWork, listPendingProposalsForAgency or any table read", async () => {
    requireAgencyMock.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(AgencyWorkPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(listAgencyWorkMock).not.toHaveBeenCalled();
    expect(listPendingProposalsForAgencyMock).not.toHaveBeenCalled();
    expect(fake.log).toEqual([]);
    expect(listAccountsWithStaleUsageMock).not.toHaveBeenCalled();
    expect(listBillingAlertsMock).not.toHaveBeenCalled();
  });

  it("renders the chosen heading once the agency check passes", async () => {
    const html = renderToStaticMarkup(await AgencyWorkPage());
    expect(html).toMatch(new RegExp(`<h1[^>]*>${m["work.agency.title"]}</h1>`));
  });

  it("never falls back to UTC for one account's invalid zone, while another account's own overdue task still resolves in ITS zone", async () => {
    // acct-bad's zone cannot resolve a day boundary at all — its row must
    // still render (Waiting, no date), not take the page down and not
    // borrow acct-good's zone or the server's.
    listAgencyWorkMock.mockResolvedValueOnce([
      row({ id: "task:bad", accountId: "acct-bad", timezone: "Not/AZone", dueAt: "2026-09-01T00:00:00Z" }),
      row({ id: "task:overdue", accountId: "acct-good", timezone: "America/Chicago", dueAt: "2026-09-01T00:00:00Z" }),
    ]);
    const html = renderToStaticMarkup(await AgencyWorkPage());
    expect(html).toContain(m["work.bucket.waiting"]);
    expect(html).toContain(m["work.bucket.overdue"]);
  });

  it("renders the sold-empty-state sentence when every account's queue is empty", async () => {
    const html = renderToStaticMarkup(await AgencyWorkPage());
    expect(html).toContain(m["work.empty"]);
    expect(html).toContain(m["work.agency.empty.body"]);
  });

  it("a To-do on a shared number's holding record names the number, never \"Caller\"; a customer's row keeps their name (S-47e P19; T17 review M9; mutation: contactDisplayName for every row -> FAILS)", async () => {
    listAgencyWorkMock.mockResolvedValueOnce([
      row({ id: "task:hold", contactId: "ct-hold", title: "A reply from a shared number couldn't be matched to one appointment" }),
      row({ id: "task:ana", contactId: "ct-ana", title: "Call Ana back" }),
    ]);
    fake.tables.contacts = [
      { id: "ct-hold", first_name: "Caller", last_name: null, phone: "+19565550142", holds_shared_number: true },
      { id: "ct-ana", first_name: "Ana", last_name: "López", phone: "+19565550142", holds_shared_number: false },
    ];
    const text = renderedText(renderToStaticMarkup(await AgencyWorkPage()));
    expect(text).toContain("Shared number (956) 555-0142");
    expect(text).toContain("Ana López");
    expect(text).not.toMatch(/\bCaller\b/);
  });

  it("a To-do on an archived contact is still listed, marked Archived, never hidden (contacts-archive Task 12; mutation: filter archived out -> row disappears, FAILS; mutation: drop the mark -> FAILS)", async () => {
    listAgencyWorkMock.mockResolvedValueOnce([
      row({ id: "task:archived", contactId: "ct-archived", title: "Follow up on the estimate" }),
      row({ id: "task:active", contactId: "ct-active", title: "Call Ana back" }),
    ]);
    fake.tables.contacts = [
      { id: "ct-archived", first_name: "Maria", last_name: "Garcia", archived_at: "2026-10-20T10:00:00Z" },
      { id: "ct-active", first_name: "Ana", last_name: "López", archived_at: null },
    ];
    const text = renderedText(renderToStaticMarkup(await AgencyWorkPage()));
    expect(text).toContain("Follow up on the estimate");
    expect(text).toContain(`Maria Garcia · ${m["contacts.archived.mark"]}`);
    expect(text).toContain("Ana López");
    expect(text).not.toContain(`Ana López · ${m["contacts.archived.mark"]}`);
  });

  it("renders no line-down banner on the good day, when the count is zero", async () => {
    const html = renderToStaticMarkup(await AgencyWorkPage());
    expect(html).not.toContain(m["work.linesDown.action"]);
  });

  it("renders the line-down banner when a number is turning callers away, and reads the window off the real clock", async () => {
    countLinesTurningCallersAwayMock.mockResolvedValueOnce(2);
    const before = Date.now();
    const html = renderToStaticMarkup(await AgencyWorkPage());
    const after = Date.now();

    expect(html).toContain(m["work.linesDown.many"].replace("{n}", "2"));
    expect(html).toContain(m["work.linesDown.action"]);

    // A 24-hour-old `sinceIso`, computed from the clock this call actually
    // ran on — not a fixed literal that would drift true the day this test
    // was written and false every day after.
    expect(countLinesTurningCallersAwayMock).toHaveBeenCalledTimes(1);
    const sinceIso = countLinesTurningCallersAwayMock.mock.calls[0]![1] as string;
    const sinceMs = new Date(sinceIso).getTime();
    expect(sinceMs).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000 - 1000);
    expect(sinceMs).toBeLessThanOrEqual(after - 24 * 60 * 60 * 1000 + 1000);
  });

  it("runs the lines-down read CONCURRENTLY with listAgencyWork, not chained after it (mutation: await listAgencyWork before starting the lines-down read -> FAILS)", async () => {
    // Each mock's own promise resolves only once the OTHER has already been
    // invoked. A serial `await listAgencyWork(db)` then
    // `await countLinesTurningCallersAway(db, since)` would deadlock this
    // test (neither mock's condition would ever come true) and the test
    // would time out rather than pass — which is the point: a passing run
    // is only possible when both reads are in flight at once.
    let listCalled = false;
    let countCalled = false;
    listAgencyWorkMock.mockReset().mockImplementation(async () => {
      listCalled = true;
      while (!countCalled) await new Promise((r) => setTimeout(r, 1));
      return [];
    });
    countLinesTurningCallersAwayMock.mockReset().mockImplementation(async () => {
      countCalled = true;
      while (!listCalled) await new Promise((r) => setTimeout(r, 1));
      return 0;
    });

    await expect(AgencyWorkPage()).resolves.toBeTruthy();
  }, 2000);

  it("swallows a failed lines-down read and still renders the whole queue (mutation: let the rejection propagate instead of catching it -> FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listAgencyWorkMock.mockResolvedValueOnce([row()]);
    countLinesTurningCallersAwayMock.mockRejectedValueOnce(new Error("permission denied for table screened_calls"));

    const html = renderToStaticMarkup(await AgencyWorkPage());

    // The queue itself is still there…
    expect(html).toContain("Call back");
    // …only the banner is missing…
    expect(html).not.toContain(m["work.linesDown.action"]);
    // …and the swallow left a trace, the way calls/page.tsx's own read does.
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("lines-down read failed"));
    spy.mockRestore();
  });

  // Work Queue Task 10 — pending suggestions, rendered beside the real
  // queue, never inside it. Since item 8b-2 (spec 5.2) they are the tray's
  // own cards, with their actions, grouped by account.
  it("renders pending suggestions as cards in their own section", async () => {
    listPendingProposalsForAgencyMock.mockResolvedValueOnce([proposal()]);
    const html = renderToStaticMarkup(await AgencyWorkPage());
    expect(html).toMatch(/<section[^>]*data-proposals/);
    expect(cardsIn(html)).toEqual(["prop-1"]);
    expect(renderedText(html)).toContain(T.text("suggestions.heading"));
  });

  it("renders no suggestions section when there are no pending suggestions", async () => {
    const html = renderToStaticMarkup(await AgencyWorkPage());
    expect(html).not.toMatch(/data-proposals/);
  });

  // THE PROOF THE WIRING ITSELF NEVER CONTAMINATES bucketAgencyWork's INPUT
  // — the exact integration point named in the task-10 brief. Asserting the
  // waiting section's own `<li>` COUNT is invariant to how a fold is shaped.
  it("keeps the waiting section's own <li> count exactly at the real bucketed rows, even with a distinct suggestion rendered alongside it (mutation: concat suggestion-derived rows into `rows` before bucketing -> FAILS)", async () => {
    listAgencyWorkMock.mockResolvedValueOnce([row({ id: "task:1", title: "Call back" })]);
    listPendingProposalsForAgencyMock.mockResolvedValueOnce([proposal({
      id: "prop-unique", payload: { title: "UNIQUE_TASK_TITLE_5678", dueAt: null },
      evidence: "UNIQUE_CALLER_QUOTE_1234",
    })]);
    const html = renderToStaticMarkup(await AgencyWorkPage());

    const waitingSection = html.match(/<section data-bucket="waiting"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect((waitingSection.match(/<li[ >]/g) ?? []).length).toBe(1);
    expect(html).toContain("UNIQUE_TASK_TITLE_5678");
    expect(html).toContain("UNIQUE_CALLER_QUOTE_1234");
  });

  it("a failed suggestions read is the section's error state with Retry, and the queue still renders (rule 5; mutation: swallow it to no section -> FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listAgencyWorkMock.mockResolvedValueOnce([row()]);
    listPendingProposalsForAgencyMock.mockRejectedValueOnce(new Error("permission denied for table proposals"));

    const html = renderToStaticMarkup(await AgencyWorkPage());

    expect(html).toContain("Call back");
    expect(renderedText(html)).toContain(T.text("suggestions.loadFailed"));
    expect(html).toMatch(new RegExp(`<button[^>]*>${T.text("common.retry")}</button>`));
    expect(cardsIn(html)).toEqual([]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("suggestions read failed"));
    // The log carries the error, never a caller's words.
    expect(spy.mock.calls.flat().join(" ")).not.toContain("the caller asked");
    spy.mockRestore();
  });

  it("runs the suggestions read CONCURRENTLY with listAgencyWork, not chained after it (mutation: await listAgencyWork before starting the suggestions read -> FAILS)", async () => {
    let listCalled = false;
    let proposalsCalled = false;
    listAgencyWorkMock.mockReset().mockImplementation(async () => {
      listCalled = true;
      while (!proposalsCalled) await new Promise((r) => setTimeout(r, 1));
      return [];
    });
    listPendingProposalsForAgencyMock.mockReset().mockImplementation(async () => {
      proposalsCalled = true;
      while (!listCalled) await new Promise((r) => setTimeout(r, 1));
      return [];
    });

    await expect(AgencyWorkPage()).resolves.toBeTruthy();
  }, 2000);

  describe("each account's cards (item 8b-2, spec 5.2)", () => {
    const STAGE = () => proposal({
      kind: "opportunity_stage", payload: { opportunityId: "opp_1", fromStageId: "stage_1", toStageId: "stage_2" },
      evidence: "move this to booked now",
    } as Partial<AgencyRow>);

    it("groups by account under each brand name, newest account first, and names each account's own persona with ONE profiles read", async () => {
      listPendingProposalsForAgencyMock.mockResolvedValueOnce([
        proposal({ id: "p-old", accountId: "acct-a", brandName: "Rio Roofing", createdAt: "2026-09-01T00:00:00Z" }),
        proposal({ id: "p-new", accountId: "acct-b", brandName: "Acme HVAC", callId: "call-2", createdAt: "2026-09-03T00:00:00Z" }),
      ]);
      fake.tables.voice_profiles = [
        { account_id: "acct-a", persona_name: "Lupe" }, { account_id: "acct-b", persona_name: "Marta" },
      ];
      const html = renderToStaticMarkup(await AgencyWorkPage());
      const sections = [...html.matchAll(/<section[^>]*data-suggestion-account="([^"]+)"[\s\S]*?<h3[^>]*>([^<]*)<\/h3>/g)].map((x) => [x[1], x[2]]);
      expect(sections).toEqual([["acct-b", "Acme HVAC"], ["acct-a", "Rio Roofing"]]);
      expect(renderedText(html)).toContain("Marta · AI");
      expect(renderedText(html)).toContain("Lupe · AI");
      expect(readsOf("voice_profiles")).toHaveLength(1);
    });

    it("a capped account states its cap (the read's accountCapped)", async () => {
      listPendingProposalsForAgencyMock.mockResolvedValueOnce([proposal({ accountCapped: true })]);
      const html = renderToStaticMarkup(await AgencyWorkPage());
      expect(renderedText(html)).toContain("Showing the newest 50 for this account.");
    });

    it("a stage suggestion names its stages from ITS account's own pipeline (readSuggestionStages, account-scoped)", async () => {
      listPendingProposalsForAgencyMock.mockResolvedValueOnce([STAGE()]);
      fake.tables.opportunities = [{ id: "opp_1", account_id: "acct-a", pipeline_id: "pipe-1" }];
      fake.tables.pipeline_stages = [
        { id: "stage_1", account_id: "acct-a", pipeline_id: "pipe-1", name: "New", position: 0 },
        { id: "stage_2", account_id: "acct-a", pipeline_id: "pipe-1", name: "Booked", position: 1 },
        { id: "stage_3", account_id: "acct-a", pipeline_id: "pipe-1", name: "Won", position: 2 },
      ];
      const html = renderToStaticMarkup(await AgencyWorkPage());
      expect(html).not.toContain(m["work.empty"]);
      expect(renderedText(html)).toContain(T.text("suggestions.stage", { from: "New", to: "Booked" }));
      expect(renderedText(html)).toContain("move this to booked now");
      expect(readsOf("pipeline_stages")[0]?.eq).toContainEqual(["account_id", "acct-a"]);
    });

    it("a failed stage read is the section's error, never a card it cannot name, and the queue stands (mutation: render the cards anyway -> FAILS)", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      listAgencyWorkMock.mockResolvedValueOnce([row()]);
      listPendingProposalsForAgencyMock.mockResolvedValueOnce([STAGE()]);
      fake.tables.opportunities = [{ id: "opp_1", account_id: "acct-a", pipeline_id: "pipe-1" }];
      fake.fail.add("pipeline_stages");
      const html = renderToStaticMarkup(await AgencyWorkPage());
      expect(cardsIn(html)).toEqual([]);
      expect(renderedText(html)).toContain(T.text("suggestions.loadFailed"));
      expect(html).toContain("Call back");
      expect(html).not.toContain("stage_1");
      spy.mockRestore();
    });

    it("a task's due date is drawn in ITS OWN account's zone, never one zone for the page (mutation: one shared zone -> FAILS)", async () => {
      listPendingProposalsForAgencyMock.mockResolvedValueOnce([
        proposal({ id: "p-chi", accountId: "acct-chi", payload: { title: "Call back Tuesday", dueAt: "2099-09-23T01:00:00.000Z" }, timezone: "America/Chicago" }),
        proposal({ id: "p-utc", accountId: "acct-utc", callId: "call-2", payload: { title: "Call back Wednesday", dueAt: "2099-09-23T01:00:00.000Z" }, timezone: "UTC" }),
      ]);
      const text = renderedText(renderToStaticMarkup(await AgencyWorkPage()));
      expect(text).toContain(T.text("suggestions.due", { date: "Sep 22, 2099" }));
      expect(text).toContain(T.text("suggestions.due", { date: "Sep 23, 2099" }));
    });

    it("an account whose stored zone is unusable keeps its card (a stated fallback zone), and its neighbour keeps its own zone", async () => {
      listPendingProposalsForAgencyMock.mockResolvedValueOnce([
        proposal({ id: "p-bad", accountId: "acct-bad", payload: { title: "Call back Tuesday", dueAt: "2099-09-23T01:00:00.000Z" }, timezone: "Not/AZone" }),
        proposal({ id: "p-ok", accountId: "acct-ok", callId: "call-2", payload: { title: "Call back Wednesday", dueAt: "2099-09-23T01:00:00.000Z" }, timezone: "America/Chicago" }),
      ]);
      const html = renderToStaticMarkup(await AgencyWorkPage());
      expect(cardsIn(html).sort()).toEqual(["p-bad", "p-ok"]);
      expect(renderedText(html)).toContain(T.text("suggestions.due", { date: "Sep 22, 2099" }));
    });

    it("the group names the row's own customer from the page's one contacts batch, and the card names the call's caller", async () => {
      listPendingProposalsForAgencyMock.mockResolvedValueOnce([proposal({ contactId: "ct-rosa", callId: "call-1" })]);
      fake.tables.calls = [{ id: "call-1", account_id: "acct-a", started_at: "2026-09-01T15:00:00Z", contact_id: "ct-ana" }];
      fake.tables.contacts = [
        { id: "ct-rosa", first_name: "Rosa", last_name: "Díaz" }, { id: "ct-ana", first_name: "Ana", last_name: "López" },
      ];
      const html = renderToStaticMarkup(await AgencyWorkPage());
      expect(html).toMatch(/<h4[^>]*>Rosa Díaz · from the call on Tue, Sep 1<\/h4>/);
      expect(renderedText(html)).toContain("From the call on Tue, Sep 1 · Ana López");
      expect(readsOf("contacts")).toHaveLength(1);
    });

    // Final review M-4: the group heading's day is the ACCOUNT's, as the card's is. 03:00Z on Sep 2 is
    // still Tue, Sep 1 in Chicago; in UTC it would read Wed, Sep 2.
    it("the group heading's day is the account's own zone (mutation: group in UTC -> 'Wed, Sep 2', FAILS)", async () => {
      listPendingProposalsForAgencyMock.mockResolvedValueOnce([proposal({ contactId: "ct-rosa", callId: "call-1", timezone: "America/Chicago" })]);
      fake.tables.calls = [{ id: "call-1", account_id: "acct-a", started_at: "2026-09-02T03:00:00Z", contact_id: "ct-rosa" }];
      fake.tables.contacts = [{ id: "ct-rosa", first_name: "Rosa", last_name: "Díaz" }];
      const html = renderToStaticMarkup(await AgencyWorkPage());
      expect(html).toMatch(/<h4[^>]*>Rosa Díaz · from the call on Tue, Sep 1<\/h4>/);
      expect(html).not.toContain("Wed, Sep 2");
    });

    // Final review M-6: the suggestions read takes the page's one clock, as every other clock-bound read does.
    it("the suggestions read is handed the page's one clock (mutation: call it without now -> FAILS)", async () => {
      await AgencyWorkPage();
      const [db, now] = listPendingProposalsForAgencyMock.mock.calls[0]!;
      expect(db).toBe(FAKE_DB);
      expect(now).toBeInstanceOf(Date);
      expect(now).toBe(listAccountsWithStaleUsageMock.mock.calls[0]![1]);
    });

    // Review fix round, Minor 5: this used to read the OPERATOR's own Mis preferencias choice
    // (requestLocale, isOperator: true) — but contactDisplayName in the contacts batch below never
    // took a locale at all, so a nameless/archived row's cell mixed languages ("(no name) ·
    // Archivado") for a Spanish-reading operator. Agency-only screens stay English (Q4(a)): this
    // page now carries no per-reader locale, so the operator's own preference must never reach it.
    it("stays English even when the operator's own language is Spanish (Q4(a); mutation: resolve locale from the operator's own prefs again -> FAILS)", async () => {
      prefsMock.mockResolvedValue({ language: "es", theme: null });
      listPendingProposalsForAgencyMock.mockResolvedValueOnce([proposal()]);
      const html = renderToStaticMarkup(await AgencyWorkPage());
      expect(html).toMatch(/<section[^>]*lang="en"[^>]*data-proposals|<section[^>]*data-proposals[^>]*lang="en"|<section lang="en"[^>]*data-proposals/);
      expect(html).toMatch(/<h2[^>]*>Suggestions<\/h2>/);
      expect(html).toMatch(/>Accept</);
      expect(html).not.toContain("Sugerencias");
    });
  });

  // Review fix round, Minor 5: the exact regression the review named — a nameless, archived
  // contact's cell reading "(no name) · Archivado" (English contactDisplayName beside a Spanish
  // tr.text) when the operator's own Mis preferencias choice was Español. Pinning this page's own
  // locale to "en" closes it: both halves of the cell now always agree.
  it("a nameless, archived contact's cell never mixes languages, even when the operator's own preference is Spanish (mutation: pin only tr's locale, or only contactDisplayName's -> FAILS)", async () => {
    prefsMock.mockResolvedValue({ language: "es", theme: null });
    listAgencyWorkMock.mockResolvedValueOnce([
      row({ id: "task:noname", contactId: "ct-noname", title: "Follow up on the estimate" }),
    ]);
    fake.tables.contacts = [
      { id: "ct-noname", first_name: null, last_name: null, archived_at: "2026-10-20T10:00:00Z" },
    ];
    const text = renderedText(renderToStaticMarkup(await AgencyWorkPage()));
    expect(text).toContain(`${m["contact.noName"]} · ${m["contacts.archived.mark"]}`);
    expect(text).not.toContain(m["contact.noName.es"]);
    expect(text).not.toContain(m["contacts.archived.mark.es"]);
  });

  // Client billing: usage that has not reached Stripe in over a day.
  it("renders the stale-usage banner with the NUMBER of billed clients behind, reading the real clock (mutation: pass a fixed date → FAILS; always render → the next test FAILS)", async () => {
    listAccountsWithStaleUsageMock.mockResolvedValueOnce(["acct-a", "acct-b"]);
    const before = Date.now();
    const { default: AgencyWorkPage } = await import("./page");
    const text = renderedText(renderToStaticMarkup(await AgencyWorkPage()));
    const after = Date.now();
    expect(text).toContain(m["work.usageStale.many"].replace("{n}", "2"));
    expect(text).toContain(m["work.usageStale.action"]);
    expect(listAccountsWithStaleUsageMock).toHaveBeenCalledTimes(1);
    const now = listAccountsWithStaleUsageMock.mock.calls[0]![1];
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });

  it("renders no stale-usage banner when every billed client's usage has reached Stripe (mutation: mount the banner with a fixed count, or `staleUsage.length || 1` → FAILS)", async () => {
    const { default: AgencyWorkPage } = await import("./page");
    const text = renderedText(renderToStaticMarkup(await AgencyWorkPage()));
    expect(text).not.toContain(m["work.usageStale.action"]);
  });

  it("swallows a failed stale-usage read and still renders the whole queue (mutation: let the rejection propagate → FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listAgencyWorkMock.mockResolvedValueOnce([row()]);
    listAccountsWithStaleUsageMock.mockRejectedValueOnce(new Error("permission denied for table usage_events"));
    const { default: AgencyWorkPage } = await import("./page");
    const text = renderedText(renderToStaticMarkup(await AgencyWorkPage()));
    expect(text).toContain("Call back");
    expect(text).not.toContain(m["work.usageStale.action"]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("stale-usage read failed"));
    spy.mockRestore();
  });

  // The agency billing banner (Task 11, plan G13) — LineDownBanner's own
  // design, derived and never stored.
  const PAUSED: BillingAlert = { accountId: "acct-paused", accountName: "Rio Roofing", kind: "paused", since: "2026-10-01T00:00:00.000Z" };

  it("renders no billing-alert banner when there are no alerts", async () => {
    const html = renderToStaticMarkup(await AgencyWorkPage());
    expect(html).not.toContain(m["work.agency.billing.paused"]);
  });

  it("renders the billing-alert banner below the stale-usage banner when there are alerts, reading the real clock and the enforced switch (mutation: hard-code enforced true or false → FAILS)", async () => {
    listBillingAlertsMock.mockResolvedValueOnce({ alerts: [PAUSED], reconciliationUnchecked: false });
    const before = Date.now();
    vi.stubEnv("BILLING_ENFORCE", "1");
    const html = renderToStaticMarkup(await AgencyWorkPage());
    const after = Date.now();

    expect(renderedText(html)).toContain(m["work.agency.billing.paused"]);
    expect(html).toContain('data-account-id="acct-paused"');
    expect(html.indexOf(m["work.usageStale.action"]) === -1 || html.indexOf(m["work.usageStale.action"]) < html.indexOf("acct-paused")).toBe(true);

    expect(listBillingAlertsMock).toHaveBeenCalledTimes(1);
    const [, now, opts] = listBillingAlertsMock.mock.calls[0]!;
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
    expect(opts).toEqual({ enforced: true });

    listBillingAlertsMock.mockClear().mockResolvedValueOnce({ alerts: [PAUSED], reconciliationUnchecked: false });
    vi.stubEnv("BILLING_ENFORCE", undefined);
    await AgencyWorkPage();
    expect(listBillingAlertsMock.mock.calls[0]![2]).toEqual({ enforced: false });
  });

  it("a reconciliation read listBillingAlerts could not make shows the banner's \"couldn't check\" line beside the paused line it still has (design review I3) (mutation: drop reconciliationUnchecked on the way to the banner → FAILS)", async () => {
    listBillingAlertsMock.mockResolvedValueOnce({ alerts: [PAUSED], reconciliationUnchecked: true });
    const text = renderedText(renderToStaticMarkup(await AgencyWorkPage()));
    expect(text).toContain(m["work.agency.billing.paused"]);
    expect(text).toContain(m["work.agency.billing.unchecked"]);
    listBillingAlertsMock.mockResolvedValueOnce({ alerts: [], reconciliationUnchecked: true });
    expect(renderedText(renderToStaticMarkup(await AgencyWorkPage()))).toContain(m["work.agency.billing.unchecked"]);
    expect(renderedText(renderToStaticMarkup(await AgencyWorkPage()))).not.toContain(m["work.agency.billing.unchecked"]);
  });

  it("swallows a failed billing-alerts read and still renders the whole queue (mutation: let the rejection propagate → FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listAgencyWorkMock.mockResolvedValueOnce([row()]);
    listBillingAlertsMock.mockRejectedValueOnce(new Error("permission denied for table account_billing"));
    const html = renderToStaticMarkup(await AgencyWorkPage());
    const text = renderedText(html);
    expect(text).toContain("Call back");
    expect(text).not.toContain(m["work.agency.billing.paused"]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("billing-alerts read failed"));
    spy.mockRestore();
  });

  it("runs the billing-alerts read CONCURRENTLY with listAgencyWork, not chained after it (mutation: await listAgencyWork before starting the billing-alerts read -> FAILS)", async () => {
    let listCalled = false;
    let alertsCalled = false;
    listAgencyWorkMock.mockReset().mockImplementation(async () => {
      listCalled = true;
      while (!alertsCalled) await new Promise((r) => setTimeout(r, 1));
      return [];
    });
    listBillingAlertsMock.mockReset().mockImplementation(async () => {
      alertsCalled = true;
      while (!listCalled) await new Promise((r) => setTimeout(r, 1));
      return NO_ALERTS;
    });

    await expect(AgencyWorkPage()).resolves.toBeTruthy();
  }, 2000);
});
