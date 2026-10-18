import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExpiringDocument } from "@bis/db";

const db = vi.hoisted(() => ({
  listExpiringDocuments: vi.fn(), listDocumentExpiryTaskKeys: vi.fn(), documentRequestTarget: vi.fn(), ensureDocumentExpiryTask: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));
import { expiryTaskKey } from "@bis/db";
import { openExpiryTasks, documentsExpiryPass, EXPIRY_TASKS_PER_RUN, EXPIRY_CANDIDATES_PER_RUN, EXPIRY_BUDGET_MS } from "./documents-expiry";

/** S-07 3a (spec 3.2, 6): who opens a To-do, once, where, titled and due how, and what a bad document or a slow run does. */
const NOW = new Date("2026-11-01T03:00:00Z");   // Chicago's day is Oct 31, Berlin's Nov 1
const FAKE_DB = { tag: "service" } as never;
const ZERO = { opened: 0, alreadyOpen: 0, failed: 0, unresolvableTimezone: 0, capped: 0, deferred: 0 };
let n = 0;
const row = (o: Partial<ExpiringDocument> = {}): ExpiringDocument => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, account_id: "acct-chi", contact_id: "c-ana", client_group_id: null,
  title: "Póliza", category: "insurance", expires_on: "2026-11-20", owners_only: false, deleted_at: null, version_scan: "clean",
  account_timezone: "America/Chicago", account_language: "en", ...o,
});
const BERLIN = { account_id: "acct-ber", account_timezone: "Europe/Berlin" } as const;
const opened = () => db.ensureDocumentExpiryTask.mock.calls.map((c) => (c[2] as { documentId: string }).documentId);
let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  db.listDocumentExpiryTaskKeys.mockResolvedValue(new Set());
  db.documentRequestTarget.mockImplementation(async (_db: unknown, _a: string, ref: { contact_id: string | null }) =>
    ({ name: "Ana García", contactId: ref.contact_id, language: null, phone: null, email: null, phoneCountryUnconfirmed: null }));
  db.ensureDocumentExpiryTask.mockResolvedValue({ id: "t1", created: true });
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

describe("the window, in each account's own day (spec 3.2)", () => {
  it("opens day 30 and day 0 in Chicago and day 30 in Berlin, never day 31 or a past date, across midnight UTC (mutation: the UTC day for every account -> FAILS)", async () => {
    const chi30 = row({ expires_on: "2026-11-30" }); const chi31 = row({ expires_on: "2026-12-01" }); const chi0 = row({ expires_on: "2026-10-31" });
    const ber30 = row({ ...BERLIN, expires_on: "2026-12-01" }); const berPast = row({ ...BERLIN, expires_on: "2026-10-31" });
    db.listExpiringDocuments.mockResolvedValue([chi30, chi31, chi0, ber30, berPast]);
    const c = await openExpiryTasks(FAKE_DB, NOW);
    expect(opened().sort()).toEqual([chi30.id, chi0.id, ber30.id].sort());
    expect(c).toEqual({ ...ZERO, opened: 3 });
    expect(db.listExpiringDocuments).toHaveBeenCalledWith(FAKE_DB, { fromDay: "2026-10-31", toDay: "2026-12-02", limit: EXPIRY_CANDIDATES_PER_RUN, accountId: undefined });
  });

  it("re-checks the read's rules: Owners only, trashed, not clean, or on no customer opens nothing (mutation: drop the pass's own check -> FAILS)", async () => {
    db.listExpiringDocuments.mockResolvedValue([
      row({ owners_only: true }), row({ deleted_at: "2026-10-30T00:00:00Z" }), row({ version_scan: "pending" }), row({ contact_id: null, client_group_id: null }),
    ]);
    await openExpiryTasks(FAKE_DB, NOW);
    expect(db.ensureDocumentExpiryTask).not.toHaveBeenCalled();
  });

  it("an account whose zone cannot be resolved opens nothing and is counted once (mutation: fall back to UTC -> FAILS)", async () => {
    db.listExpiringDocuments.mockResolvedValue([row({ account_timezone: "Mars/Olympus" }), row({ account_timezone: "Mars/Olympus" })]);
    const c = await openExpiryTasks(FAKE_DB, NOW);
    expect(db.ensureDocumentExpiryTask).not.toHaveBeenCalled();
    expect(c.unresolvableTimezone).toBe(1);
  });

  it("scopes the read to one account when asked (the e2e's only way in; mutation: drop scope.accountId -> FAILS)", async () => {
    db.listExpiringDocuments.mockResolvedValue([]);
    await openExpiryTasks(FAKE_DB, NOW, { accountId: "acct-chi" });
    expect(db.listExpiringDocuments.mock.calls[0]![1]).toMatchObject({ accountId: "acct-chi" });
  });
});

describe("one To-do per document and date (spec 3.2 dedupe, re-arm)", () => {
  it("a key that already has its To-do is skipped and counted (mutation: ignore the keys -> FAILS)", async () => {
    const r = row();
    db.listExpiringDocuments.mockResolvedValue([r]);
    db.listDocumentExpiryTaskKeys.mockResolvedValue(new Set([expiryTaskKey(r.id, r.expires_on)]));
    const c = await openExpiryTasks(FAKE_DB, NOW);
    expect(db.ensureDocumentExpiryTask).not.toHaveBeenCalled();
    expect(c).toMatchObject({ opened: 0, alreadyOpen: 1 });
  });

  it("a new expiry date re-arms: the old date's To-do does not count (mutation: key on the document id alone -> FAILS)", async () => {
    const r = row({ expires_on: "2026-11-20" });
    db.listExpiringDocuments.mockResolvedValue([r]);
    db.listDocumentExpiryTaskKeys.mockResolvedValue(new Set([expiryTaskKey(r.id, "2026-11-10")]));
    await openExpiryTasks(FAKE_DB, NOW);
    expect(db.ensureDocumentExpiryTask.mock.calls[0]![2]).toMatchObject({ documentId: r.id, expiresOn: "2026-11-20" });
  });
});

describe("the To-do: where, titled and due how (spec 3.2)", () => {
  it("lands on the customer, titled in the ACCOUNT's language, due 7 days before at 09:00 there, by the system (mutations: the reader's language, or due on the expiry day -> FAILS)", async () => {
    const r = row({ account_language: "es", expires_on: "2026-11-30" });
    db.listExpiringDocuments.mockResolvedValue([r]);
    await openExpiryTasks(FAKE_DB, NOW);
    expect(db.ensureDocumentExpiryTask).toHaveBeenCalledWith(FAKE_DB, "acct-chi",
      { documentId: r.id, expiresOn: "2026-11-30", contactId: "c-ana", title: "El seguro de Ana García vence el 30 nov", dueAt: "2026-11-23T15:00:00.000Z" },
      "documents-expiry", "system");
  });

  it("a household's file lands on its primary contact, named by the household; with no primary, on nobody (mutation: pass the document's own contact_id -> FAILS)", async () => {
    const g1 = row({ contact_id: null, client_group_id: "g1" }); const g2 = row({ contact_id: null, client_group_id: "g2" });
    db.listExpiringDocuments.mockResolvedValue([g1, g2]);
    db.documentRequestTarget.mockImplementation(async (_db: unknown, _a: string, ref: { client_group_id: string | null }) =>
      ({ name: "Casa García", contactId: ref.client_group_id === "g1" ? "c-primary" : null, language: null, phone: null, email: null, phoneCountryUnconfirmed: null }));
    await openExpiryTasks(FAKE_DB, NOW);
    const byDoc = Object.fromEntries(db.ensureDocumentExpiryTask.mock.calls.map((c) => [(c[2] as { documentId: string }).documentId, c[2]]));
    expect(byDoc[g1.id]).toMatchObject({ contactId: "c-primary", title: "Casa García's insurance expires on Nov 20" });
    expect(byDoc[g2.id]).toMatchObject({ contactId: null, title: "Casa García's insurance expires on Nov 20" });
    expect(db.documentRequestTarget).toHaveBeenCalledWith(FAKE_DB, "acct-chi", expect.objectContaining({ contact_id: null, client_group_id: "g1" }));
  });
});

describe("the run's limits and failures (spec 3.2; review M4)", () => {
  it(`a full candidate read (${EXPIRY_CANDIDATES_PER_RUN} rows) says it was capped even when every To-do is already open (mutation: drop the read cap's flag and log -> FAILS)`, async () => {
    const rows = Array.from({ length: EXPIRY_CANDIDATES_PER_RUN }, () => row());
    db.listExpiringDocuments.mockResolvedValue(rows);
    db.listDocumentExpiryTaskKeys.mockResolvedValue(new Set(rows.map((r) => expiryTaskKey(r.id, r.expires_on))));
    const c = await openExpiryTasks(FAKE_DB, NOW);
    expect(db.ensureDocumentExpiryTask).not.toHaveBeenCalled();
    expect(c).toEqual({ ...ZERO, alreadyOpen: EXPIRY_CANDIDATES_PER_RUN, capped: 1 });
    expect(errors.mock.calls.flat().join(" ")).toContain("candidate read came back full");
  });

  it(`opens at most ${EXPIRY_TASKS_PER_RUN} To-dos and says it was capped (mutation: no cap -> FAILS)`, async () => {
    db.listExpiringDocuments.mockResolvedValue(Array.from({ length: EXPIRY_TASKS_PER_RUN + 1 }, () => row()));
    const c = await openExpiryTasks(FAKE_DB, NOW);
    expect(db.ensureDocumentExpiryTask).toHaveBeenCalledTimes(EXPIRY_TASKS_PER_RUN);
    expect(c.capped).toBe(1);
    expect(errors.mock.calls.flat().join(" ")).toContain("capped");
  });

  it(`stops STARTING a To-do once ${EXPIRY_BUDGET_MS} ms have gone and counts the rest as deferred (mutation: drop the cutoff -> all three open -> FAILS)`, async () => {
    db.listExpiringDocuments.mockResolvedValue([row(), row(), row()]);
    const times = [0, 0, EXPIRY_BUDGET_MS + 1];
    const clock = () => times.shift() ?? EXPIRY_BUDGET_MS + 1;   // the start, then before each To-do
    const c = await openExpiryTasks(FAKE_DB, NOW, { clock });
    expect(db.ensureDocumentExpiryTask).toHaveBeenCalledTimes(1);
    expect(c).toMatchObject({ opened: 1, deferred: 2 });
  });

  it("one document's failure does not stop the others; the run then throws with its counters, logging ids, never the file's title (mutations: rethrow at once -> the second is never opened; log the title -> FAILS)", async () => {
    const bad = row(); const good = row();
    db.listExpiringDocuments.mockResolvedValue([bad, good]);
    db.ensureDocumentExpiryTask.mockImplementation(async (_db: unknown, _a: string, input: { documentId: string }) => {
      if (input.documentId === bad.id) throw new Error("insert failed");
      return { id: "t2", created: true };
    });
    await expect(openExpiryTasks(FAKE_DB, NOW)).rejects.toThrow("\"failed\":1");
    expect(opened()).toEqual([bad.id, good.id]);
    const logged = errors.mock.calls.flat().join(" ");
    expect(logged).toContain(bad.id);
    expect(logged).toContain("acct-chi");
    expect(logged).not.toContain("Póliza");
  });
});

describe("the registered pass", () => {
  it("is documentsExpiry, runs on the tick's client and instant; nothing due is one read and zero counters (mutations: read the keys with no candidates, or run on a client or instant other than the tick's -> FAILS)", async () => {
    db.listExpiringDocuments.mockResolvedValue([]);
    expect(documentsExpiryPass.key).toBe("documentsExpiry");
    const c = await documentsExpiryPass.run({ db: FAKE_DB, now: NOW, origin: "https://x", email: {} as never, sms: {} as never });
    expect(c).toEqual(ZERO);
    // The tick's client, and the range read off the tick's instant (NOW's UTC day is 2026-11-01: from - 1, to + 31).
    expect(db.listExpiringDocuments).toHaveBeenCalledTimes(1);
    expect(db.listExpiringDocuments).toHaveBeenCalledWith(FAKE_DB, expect.objectContaining({ fromDay: "2026-10-31", toDay: "2026-12-02" }));
    expect(db.listDocumentExpiryTaskKeys).not.toHaveBeenCalled();
  });
});
