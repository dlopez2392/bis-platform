import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
/** Mutable (F-085 part 1): setTaskAssigneeAction's tests pick the caller's
 *  role; every other test keeps the agency caller it was written for. */
const authFixture = vi.hoisted(() => ({
  access: { userId: "user_1", isAgency: true, role: null } as
    { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null },
}));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => authFixture.access,
}));

const dbForRequestMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ dbForRequest: dbForRequestMock }));

// S-10 T3: the consent To-do's own words (todo.consent.decided/failed, with no errorKey mechanism
// of their own — unlike work.actionFailed) resolve the reader's locale the same way contacts/
// actions.ts's languageError does — real requestLocale/t, only the person's own preference mocked.
const getPersonPrefsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/preferences/person-prefs", () => ({
  getPersonPrefs: (...a: unknown[]) => getPersonPrefsMock(...a),
}));

const dbMocks = vi.hoisted(() => ({
  addTask: vi.fn(),
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
  readTaskContact: vi.fn<(...a: unknown[]) => Promise<{ contactId: string | null; consentEventId: string | null } | null>>(async () =>
    ({ contactId: "c1", consentEventId: "h1" })),
  readConsentHistory: vi.fn(async () => []),
  completeTasksForConsentEvents: vi.fn(async () => ["t1"]),
  // F-085 part 1: handing a task to someone.
  setTaskAssignee: vi.fn(),
  listAccountTeam: vi.fn(),
  // F-085 fix round 1 (I1): "Not now" task's assignee.
  readPersonId: vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => "p-me"),
  taskAssigneeFor: vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => "p-holder"),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks,
}));

/** F-085 (spec §7.3): the client completeTask's hold check reads the ledger
 *  through — a stable sentinel, told apart from the request client by identity. */
const LEDGER = vi.hoisted(() => ({ tag: "ledger-db" }));
vi.mock("@/lib/consent/ledger-db", () => ({ ledgerDb: () => LEDGER }));

const setBookingStatusActionMock = vi.hoisted(() => vi.fn());
vi.mock("../calendar/actions", () => ({ setBookingStatusAction: setBookingStatusActionMock }));

const texts = vi.hoisted(() => ({ textsContextFor: vi.fn(), confirmStop: vi.fn(), notAStop: vi.fn(), undoHoldDecision: vi.fn() }));
vi.mock("@/lib/consent/texts-context", () => ({ textsContextFor: texts.textsContextFor }));
vi.mock("@/lib/consent/staff-actions", () => ({ confirmStop: texts.confirmStop, notAStop: texts.notAStop, undoHoldDecision: texts.undoHoldDecision }));

import { revalidatePath } from "next/cache";
import { readConsentHistory, completeTask, completeTasksForConsentEvents, HoldUndecidedError } from "@bis/db";
import { m } from "@/lib/messages";
import { completeWorkTask, reopenWorkTask, dismissToTask, closeOutBooking, confirmStopFromTask, notAStopFromTask, setTaskAssigneeAction } from "./actions";

/** A minimal fake Supabase client satisfying only the one chain
 *  `dismissToTask` reads directly (`accounts.timezone`) — everything else it
 *  touches (`addTask`) is itself mocked above and never inspects the client
 *  it's handed. */
function fakeDb(result: { data: { timezone: string } | null; error: { message: string } | null }) {
  return {
    from: (table: string) => {
      if (table !== "accounts") throw new Error(`fakeDb: unexpected table "${table}"`);
      return { select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) };
    },
  };
}

/** The exact object `dbForRequest()` resolves to for the current test — a
 *  distinct reference each time `beforeEach` runs. Assertions below pin THIS
 *  object as the client argument rather than `expect.anything()`: a mutation
 *  that swapped `dbForRequest()` for `serviceDb()` (as `closeOutBooking`'s
 *  own delegate legitimately does, and as the other three must NOT) would
 *  pass a real Supabase client or throw before `completeTask`/`reopenTask`/
 *  `addTask` is ever called — either way, a loose `expect.anything()` cannot
 *  tell the difference, but pinning the reference (or, for `addTask`, the
 *  exact fake client contents) can. Matches the pattern
 *  `calendar/actions.test.ts` already uses for the same reason.
 */
let db: ReturnType<typeof fakeDb>;

beforeEach(() => {
  vi.clearAllMocks();
  db = fakeDb({ data: { timezone: "America/Chicago" }, error: null });
  dbForRequestMock.mockResolvedValue(db);
  getPersonPrefsMock.mockReset().mockResolvedValue({ language: null, theme: null });
  authFixture.access = { userId: "user_1", isAgency: true, role: null };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("completeWorkTask", () => {
  it("completes the task and revalidates the To do route", async () => {
    dbMocks.completeTask.mockResolvedValue(undefined);
    const r = await completeWorkTask("acct_1", "task_1");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.completeTask).toHaveBeenCalledWith(
      db, "acct_1", "task_1", "user_1", "user", LEDGER,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/acct_1/tasks");
  });

  it("the hold check reads the ledger through the ledger client, while the task write stays on the request client (F-085, spec §7.3; mutation: completeTask without the sixth argument → FAILS)", async () => {
    dbMocks.completeTask.mockResolvedValue(undefined);
    await completeWorkTask("acct_1", "task_1");
    const call = dbMocks.completeTask.mock.calls[0] as unknown[];
    expect(call[0]).toBe(db);
    expect(call[5]).toBe(LEDGER);
  });

  it("returns an honest error instead of throwing when the write fails", async () => {
    dbMocks.completeTask.mockRejectedValue(new Error("db exploded"));
    const r = await completeWorkTask("acct_1", "task_1");
    expect(r.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  // F-085 follow-ups (final M4): the failure is named by key, so the To do's client renders it in
  // the reader's language (useLocale) beside its success toasts; `error` stays English for any
  // caller that reads only that.
  it("the failure carries its key, work.actionFailed (mutation: return only the English error -> FAILS)", async () => {
    dbMocks.completeTask.mockRejectedValue(new Error("db exploded"));
    expect(await completeWorkTask("acct_1", "task_1")).toEqual({ ok: false, error: m["work.actionFailed"], errorKey: "work.actionFailed" });
  });
});

describe("reopenWorkTask", () => {
  it("reopens the task and revalidates", async () => {
    dbMocks.reopenTask.mockResolvedValue(undefined);
    const r = await reopenWorkTask("acct_1", "task_1");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.reopenTask).toHaveBeenCalledWith(
      db, "acct_1", "task_1", "user_1",
    );
  });

  it("returns an honest error instead of throwing when the write fails, named by its key (F-085 follow-ups; mutation: drop errorKey -> FAILS)", async () => {
    dbMocks.reopenTask.mockRejectedValue(new Error("db exploded"));
    const r = await reopenWorkTask("acct_1", "task_1");
    expect(r).toEqual({ ok: false, error: m["work.actionFailed"], errorKey: "work.actionFailed" });
  });
});

describe("dismissToTask", () => {
  it("creates a task due tomorrow 09:00 in the ACCOUNT's own zone, titled with the row's own label", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T14:00:00Z"));
    dbMocks.addTask.mockResolvedValue({ id: "task_new" });

    const r = await dismissToTask("acct_1", {
      source: "conversation", contactId: "contact_1", title: "Reply to Maria Garcia",
    });

    expect(r).toEqual({ ok: true, taskId: "task_new", dueAt: "2026-09-15T14:00:00.000Z" });
    expect(dbMocks.addTask).toHaveBeenCalledWith(
      db, "acct_1",
      { contactId: "contact_1", title: "Reply to Maria Garcia", dueAt: "2026-09-15T14:00:00.000Z", assignedTo: "p-holder" },
      "user_1",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/acct_1/tasks");
  });

  it("omits the due date rather than guessing when the account's zone is unusable, and says so in the result", async () => {
    const badZoneDb = fakeDb({ data: { timezone: "Not/AZone" }, error: null });
    dbForRequestMock.mockResolvedValue(badZoneDb);
    dbMocks.addTask.mockResolvedValue({ id: "task_new" });

    const r = await dismissToTask("acct_1", { source: "booking", contactId: null, title: "Did this job happen?" });

    expect(r).toEqual({ ok: true, taskId: "task_new", dueAt: null });
    expect(dbMocks.addTask).toHaveBeenCalledWith(
      badZoneDb, "acct_1",
      { contactId: undefined, title: "Did this job happen?", dueAt: undefined, assignedTo: "p-holder" },
      "user_1",
    );
  });

  it("fails honestly, without creating anything, when the account lookup itself fails, named by its key (F-085 follow-ups; mutation: drop errorKey -> FAILS)", async () => {
    dbForRequestMock.mockResolvedValue(fakeDb({ data: null, error: { message: "boom" } }));
    const r = await dismissToTask("acct_1", { source: "conversation", contactId: "c1", title: "Reply to X" });
    expect(r).toEqual({ ok: false, error: m["work.actionFailed"], errorKey: "work.actionFailed" });
    expect(dbMocks.addTask).not.toHaveBeenCalled();
  });

  it("returns an honest error instead of throwing when the write fails, named by its key (F-085 follow-ups; mutation: drop errorKey -> FAILS)", async () => {
    dbMocks.addTask.mockRejectedValue(new Error("db exploded"));
    const r = await dismissToTask("acct_1", { source: "conversation", contactId: "c1", title: "Reply to X" });
    expect(r).toEqual({ ok: false, error: m["work.actionFailed"], errorKey: "work.actionFailed" });
  });
});

// F-085 fix round 1 (I1): "Not now" writes a real task, so it is assigned like
// any other: the customer's holder, else the person who pressed it (the
// account-scoped person read). Without it a Technician's insert was refused
// by tasks_technician_insert and Owner/Staff's landed Unassigned.
describe("dismissToTask's assignee", () => {
  beforeEach(() => {
    dbMocks.addTask.mockResolvedValue({ id: "task_new" });
    dbMocks.readPersonId.mockReset().mockResolvedValue("p-me");
    dbMocks.taskAssigneeFor.mockReset().mockResolvedValue("p-me");
  });
  afterEach(() => {
    authFixture.access = { userId: "user_1", isAgency: true, role: null };
    dbMocks.readPersonId.mockReset().mockImplementation(async () => "p-me");
    dbMocks.taskAssigneeFor.mockReset().mockImplementation(async () => "p-holder");
  });

  it.each(["technician", "staff", "owner"] as const)("a %s's Not now on their customer writes a task assigned per taskAssigneeFor, no refusal (mutation: drop assignedTo -> FAILS)", async (role) => {
    authFixture.access = { userId: "user_1", isAgency: false, role };
    const r = await dismissToTask("acct_1", { source: "conversation", contactId: "contact_1", title: "Reply to Ana" });
    expect(r.ok).toBe(true);
    expect(dbMocks.readPersonId).toHaveBeenCalledWith(db, "acct_1", "user_1");
    expect(dbMocks.taskAssigneeFor).toHaveBeenCalledWith(db, "acct_1", "contact_1", "p-me");
    expect(dbMocks.addTask.mock.calls[0]![2]).toMatchObject({ assignedTo: "p-me" });
  });

  it("a booking row with no customer goes to the person who pressed it", async () => {
    await dismissToTask("acct_1", { source: "booking", contactId: null, title: "Did this job happen?" });
    expect(dbMocks.taskAssigneeFor).toHaveBeenCalledWith(db, "acct_1", null, "p-me");
  });

  it("a failed person read is an honest failure, nothing created", async () => {
    dbMocks.readPersonId.mockRejectedValueOnce(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await dismissToTask("acct_1", { source: "conversation", contactId: "contact_1", title: "Reply to Ana" });
    expect(r.ok).toBe(false);
    expect(dbMocks.addTask).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("closeOutBooking", () => {
  it("delegates to the calendar screen's own action and ALSO revalidates the To do route", async () => {
    setBookingStatusActionMock.mockResolvedValue({ ok: true });
    const r = await closeOutBooking("acct_1", "booking_1", "completed");
    expect(r).toEqual({ ok: true });
    expect(setBookingStatusActionMock).toHaveBeenCalledWith("acct_1", "booking_1", "completed");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/acct_1/tasks");
  });

  it("forwards an unrecognised failure verbatim, with no key, and does not revalidate", async () => {
    setBookingStatusActionMock.mockResolvedValue({ ok: false, error: "Something else went wrong." });
    const r = await closeOutBooking("acct_1", "booking_1", "no_show");
    expect(r).toEqual({ ok: false, error: "Something else went wrong." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  // 2026-10-28: the calendar's close-out failures showed English on the
  // Spanish To do list. The two the calendar action can return are named by
  // key so failureText renders them in the reader's language.
  it.each(["calendar.bookings.statusUpdateFailed", "calendar.bookings.notStartedYet"] as const)(
    "names the calendar's %s failure by key (mutation: forward without errorKey -> FAILS)", async (key) => {
      setBookingStatusActionMock.mockResolvedValue({ ok: false, error: m[key] });
      const r = await closeOutBooking("acct_1", "booking_1", "completed");
      expect(r).toEqual({ ok: false, error: m[key], errorKey: key });
    });
});

describe("the consent To-do's buttons (consent chain PR-2)", () => {
  // Distinct sentinels: `{}` and `{}` are deep-equal, so a swap of the two
  // clients would pass every toHaveBeenCalledWith below unnoticed.
  const CTX = { db: { tag: "request-db" }, writer: { tag: "service-writer" }, accountId: "acct_1", contactId: "c1", userId: "user_1", actorName: null, address: "+19562921696", unconfirmed: false, now: new Date("2026-10-06T20:00:00Z") };
  beforeEach(() => {
    for (const fn of Object.values(texts)) fn.mockReset();
    texts.textsContextFor.mockResolvedValue(CTX);
    texts.confirmStop.mockResolvedValue({ ok: true, view: { kind: "stopped" } });
    texts.notAStop.mockResolvedValue({ ok: true, view: { kind: "allowed", newestId: "r1" } });
  });

  it("Confirm stop decides the contact's CURRENT hold, whatever hold the To-do was made for (mutation: pass the task's own link → FAILS)", async () => {
    vi.mocked(readConsentHistory).mockResolvedValue([
      { id: "h2", action: "held", method: "staff_undo", occurred_at: "2026-10-05T10:00:00Z", evidence: {}, note: null, actor_id: "u" },
      { id: "h1", action: "held", method: "free_text", occurred_at: "2026-10-04T10:00:00Z", evidence: {}, note: null, actor_id: null },
    ] as never);
    expect((await confirmStopFromTask("acct_1", "t1")).ok).toBe(true);
    expect(texts.confirmStop).toHaveBeenCalledWith(CTX, "h2");
  });

  it("the current-hold check reads the ledger through the SERVICE client, by address, never the request client (F-085, spec §7.3; mutation: read it on ctx.db → FAILS)", async () => {
    vi.mocked(readConsentHistory).mockResolvedValue([
      { id: "h2", action: "held", method: "free_text", occurred_at: "2026-10-05T10:00:00Z", evidence: {}, note: null, actor_id: null },
    ] as never);
    await confirmStopFromTask("acct_1", "t1");
    const call = vi.mocked(readConsentHistory).mock.calls[0]!;
    expect(call[0]).toBe(CTX.writer);
    expect(call.slice(1)).toEqual(["acct_1", "sms", "+19562921696"]);
  });

  it("a To-do whose number is no longer on hold says it was already decided, and decides nothing (mutation: decide anyway → FAILS)", async () => {
    vi.mocked(readConsentHistory).mockResolvedValue([
      { id: "r1", action: "hold_released", method: "staff", occurred_at: "2026-10-05T10:00:00Z", evidence: {}, note: null, actor_id: "u" },
    ] as never);
    expect(await notAStopFromTask("acct_1", "t1")).toEqual({ ok: false, error: m["todo.consent.decided"] });
    expect(texts.notAStop).not.toHaveBeenCalled();
  });

  it("…and that To-do closes itself, through its own ledger link, so it never sits open with two dead buttons (review R3-I1; mutation: return 'decided' without closing → FAILS)", async () => {
    vi.mocked(readConsentHistory).mockResolvedValue([
      { id: "r1", action: "resubscribed", method: "start_keyword", occurred_at: "2026-10-05T10:00:00Z", evidence: {}, note: null, actor_id: null },
    ] as never);
    await confirmStopFromTask("acct_1", "t1");
    expect(vi.mocked(completeTasksForConsentEvents)).toHaveBeenCalledWith(CTX.db, "acct_1", ["h1"], "user_1");
  });

  it("a Done on a hold's To-do while the hold is undecided (a stale tab) is refused with the decide-first line (review R3-I1; mutation: fall through to the generic failure → FAILS)", async () => {
    vi.mocked(completeTask).mockRejectedValueOnce(new HoldUndecidedError());
    expect(await completeWorkTask("acct_1", "t1")).toEqual({ ok: false, error: m["todo.consent.decideFirst"], errorKey: "todo.consent.decideFirst" });
  });

  it("a contact whose number was cleared closes the hold's To-do exactly like a number no longer on hold, rather than leaving it stuck open forever (review fix round 1, item 1; mutation: return the no-number failure without closing → FAILS)", async () => {
    texts.textsContextFor.mockResolvedValue({ ok: false, reason: "no_number", error: m["contact.texts.noNumber"] });
    expect(await confirmStopFromTask("acct_1", "t1")).toEqual({ ok: false, error: m["todo.consent.decided"] });
    expect(vi.mocked(completeTasksForConsentEvents)).toHaveBeenCalledWith(db, "acct_1", ["h1"], "user_1");
    expect(texts.confirmStop).not.toHaveBeenCalled();
  });

  it("a genuinely failed context read is NOT treated as a decided hold (the discriminator; mutation: close the To-do for every textsContextFor failure → FAILS)", async () => {
    texts.textsContextFor.mockResolvedValue({ ok: false, reason: "failed", error: m["contact.texts.failed"] });
    expect(await confirmStopFromTask("acct_1", "t1")).toEqual({ ok: false, reason: "failed", error: m["contact.texts.failed"] });
    expect(vi.mocked(completeTasksForConsentEvents)).not.toHaveBeenCalled();
  });

  // S-10 T3: "already decided" and the generic consent failure carry no errorKey (unlike
  // work.actionFailed above), so decideFromTask must resolve the reader's own locale itself.
  describe("in the reader's language (S-10 T3)", () => {
    it("'already decided' is said in Spanish for a client-role reader on a Spanish account (mutation: read m[...] directly -> FAILS)", async () => {
      authFixture.access = { userId: "user_1", isAgency: false, role: "owner" };
      dbForRequestMock.mockResolvedValue(fakeDb({ data: { language: "es" } as never, error: null }));
      vi.mocked(readConsentHistory).mockResolvedValue([
        { id: "r1", action: "hold_released", method: "staff", occurred_at: "2026-10-05T10:00:00Z", evidence: {}, note: null, actor_id: "u" },
      ] as never);
      expect(await notAStopFromTask("acct_1", "t1")).toEqual({ ok: false, error: m["todo.consent.decided.es"] });
    });

    it("an agency operator reads English even on a Spanish account (requestLocale's role split)", async () => {
      authFixture.access = { userId: "user_1", isAgency: true, role: null };
      dbForRequestMock.mockResolvedValue(fakeDb({ data: { language: "es" } as never, error: null }));
      vi.mocked(readConsentHistory).mockResolvedValue([
        { id: "r1", action: "hold_released", method: "staff", occurred_at: "2026-10-05T10:00:00Z", evidence: {}, note: null, actor_id: "u" },
      ] as never);
      expect(await notAStopFromTask("acct_1", "t1")).toEqual({ ok: false, error: m["todo.consent.decided"] });
    });

    it("the generic consent failure (a thrown read) is said in the reader's own language too", async () => {
      getPersonPrefsMock.mockResolvedValue({ language: "es", theme: null });
      authFixture.access = { userId: "user_1", isAgency: false, role: "owner" };
      texts.textsContextFor.mockRejectedValue(new Error("db down"));
      expect(await confirmStopFromTask("acct_1", "t1")).toEqual({ ok: false, error: m["todo.consent.failed.es"] });
    });
  });
});

// ---------------------------------------------------------------------------
// F-085 part 1 (spec §8): handing a task to someone. A Technician never does
// (M4), and a Technician is never handed a task about a customer they do not
// hold (A4: the customer first), because RLS would hide it from them.
// ---------------------------------------------------------------------------
describe("setTaskAssigneeAction", () => {
  const U = (n: number) => `${String(n).padStart(8, "0")}-2222-4222-8222-222222222222`;
  const TASK = U(1), CONTACT = U(2), TECH_ID = U(3), STAFF_ID = U(4), OTHER = U(5);
  const team = [
    { userId: TECH_ID, clerkUserId: "c_t", email: "t@x.test", name: "Tomás", role: "technician", language: null },
    { userId: STAFF_ID, clerkUserId: "c_s", email: "s@x.test", name: "Sara", role: "staff", language: null },
  ];
  /** The request client: only the contact's own assigned_to read. */
  const contactRead = vi.fn<() => Promise<{ data: unknown; error: unknown }>>();
  const assignDb = {
    from: (table: string) => {
      if (table !== "contacts") throw new Error(`assignDb: unexpected table "${table}"`);
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => contactRead() }) }) }) };
    },
  };

  beforeEach(() => {
    authFixture.access = { userId: "user_1", isAgency: false, role: "staff" };
    dbForRequestMock.mockResolvedValue(assignDb);
    dbMocks.listAccountTeam.mockReset().mockResolvedValue(team);
    dbMocks.setTaskAssignee.mockReset().mockResolvedValue({ previous: STAFF_ID });
    dbMocks.readTaskContact.mockReset().mockResolvedValue({ contactId: CONTACT, consentEventId: null });
    contactRead.mockReset().mockResolvedValue({ data: { assigned_to: OTHER }, error: null });
  });
  afterEach(() => {
    authFixture.access = { userId: "user_1", isAgency: true, role: null };
    dbMocks.readTaskContact.mockReset().mockImplementation(async () => ({ contactId: "c1", consentEventId: "h1" }));
  });

  it("a Technician is refused and nothing is written (mutation: drop the role check -> FAILS)", async () => {
    authFixture.access = { userId: "user_1", isAgency: false, role: "technician" };
    expect(await setTaskAssigneeAction("acct_1", TASK, STAFF_ID)).toEqual({ ok: false, error: "assign.refused" });
    expect(dbMocks.setTaskAssignee).not.toHaveBeenCalled();
  });

  it("a client whose role could not be settled is refused too (fails closed)", async () => {
    authFixture.access = { userId: "user_1", isAgency: false, role: null };
    expect(await setTaskAssigneeAction("acct_1", TASK, STAFF_ID)).toEqual({ ok: false, error: "assign.refused" });
    expect(dbMocks.setTaskAssignee).not.toHaveBeenCalled();
  });

  it("handing a Technician a task whose customer is someone else's -> assign.customerFirst, nothing written (mutation: skip the check -> FAILS)", async () => {
    expect(await setTaskAssigneeAction("acct_1", TASK, TECH_ID)).toEqual({ ok: false, error: "assign.customerFirst" });
    expect(dbMocks.setTaskAssignee).not.toHaveBeenCalled();
    expect(dbMocks.readTaskContact).toHaveBeenCalledWith(assignDb, "acct_1", TASK);
  });

  it("…and an Unassigned customer is not theirs either", async () => {
    contactRead.mockResolvedValueOnce({ data: { assigned_to: null }, error: null });
    expect(await setTaskAssigneeAction("acct_1", TASK, TECH_ID)).toEqual({ ok: false, error: "assign.customerFirst" });
    expect(dbMocks.setTaskAssignee).not.toHaveBeenCalled();
  });

  it("handing a Technician a task whose customer they already hold is allowed", async () => {
    contactRead.mockResolvedValueOnce({ data: { assigned_to: TECH_ID }, error: null });
    expect(await setTaskAssigneeAction("acct_1", TASK, TECH_ID)).toEqual({ ok: true, previous: STAFF_ID });
    expect(dbMocks.setTaskAssignee).toHaveBeenCalledWith(assignDb, "acct_1", TASK, TECH_ID, "user_1");
  });

  it("handing a Technician a task with no customer is allowed", async () => {
    dbMocks.readTaskContact.mockResolvedValueOnce({ contactId: null, consentEventId: null });
    expect(await setTaskAssigneeAction("acct_1", TASK, TECH_ID)).toEqual({ ok: true, previous: STAFF_ID });
    expect(contactRead).not.toHaveBeenCalled();
  });

  // Fix round 1 (m3): fail closed. A target the team read does not show (just
  // removed, or a race) is not assumed to be Owner/Staff: the customer-first
  // check still runs.
  it("a target missing from the team read still gets the customer-first check (mutation: treat a missing target as not a Technician -> FAILS)", async () => {
    expect(await setTaskAssigneeAction("acct_1", TASK, U(6))).toEqual({ ok: false, error: "assign.customerFirst" });
    expect(dbMocks.setTaskAssignee).not.toHaveBeenCalled();
  });

  it("handing it to Staff needs no customer check; success hands back who had it", async () => {
    dbMocks.setTaskAssignee.mockResolvedValueOnce({ previous: null });
    expect(await setTaskAssigneeAction("acct_1", TASK, STAFF_ID)).toEqual({ ok: true, previous: null });
    expect(dbMocks.readTaskContact).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/acct_1/tasks");
  });

  it("Unassigned (null) needs no team read at all", async () => {
    expect(await setTaskAssigneeAction("acct_1", TASK, null)).toEqual({ ok: true, previous: STAFF_ID });
    expect(dbMocks.listAccountTeam).not.toHaveBeenCalled();
    expect(dbMocks.setTaskAssignee).toHaveBeenCalledWith(assignDb, "acct_1", TASK, null, "user_1");
  });

  it("a task the caller cannot see -> assign.failed", async () => {
    dbMocks.setTaskAssignee.mockResolvedValueOnce("not_found");
    expect(await setTaskAssigneeAction("acct_1", TASK, STAFF_ID)).toEqual({ ok: false, error: "assign.failed" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-UUID task id", "task_1", STAFF_ID],
    ["a non-UUID assignee", U(1), "someone"],
  ])("%s -> assign.failed with no write", async (_n, taskId, assignee) => {
    expect(await setTaskAssigneeAction("acct_1", taskId, assignee)).toEqual({ ok: false, error: "assign.failed" });
    expect(dbMocks.setTaskAssignee).not.toHaveBeenCalled();
  });

  it.each([
    ["an RLS refusal (42501)", Object.assign(new Error("setTaskAssignee failed: new row violates row-level security policy for table tasks"), { code: "42501" }), "assign.refused"],
    ["the same words with no code (fix round 1, m1: never the wording)", new Error("setTaskAssignee failed: new row violates row-level security policy for table tasks"), "assign.failed"],
    ["a 42501 code", Object.assign(new Error("denied"), { code: "42501" }), "assign.refused"],
    ["not a member", new Error("assignment: the assignee is not a member of this account"), "assign.failed"],
  ] as const)("%s maps to its AssignError, logged", async (_n, err, expected) => {
    dbMocks.setTaskAssignee.mockRejectedValueOnce(err);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await setTaskAssigneeAction("acct_1", TASK, STAFF_ID)).toEqual({ ok: false, error: expected });
    expect(spy.mock.calls.flat().join(" ")).toContain("setTaskAssigneeAction: account acct_1:");
    spy.mockRestore();
  });

  // Final review M7: the task Undo names the holder its save set, and the
  // write happens only while that person still holds the task.
  it("an Undo's expected holder reaches setTaskAssignee; a task picked since answers assign.changed and revalidates nothing (mutation: drop expected -> FAILS)", async () => {
    dbMocks.setTaskAssignee.mockResolvedValueOnce("changed");
    expect(await setTaskAssigneeAction("acct_1", TASK, STAFF_ID, OTHER)).toEqual({ ok: false, error: "assign.changed" });
    expect(dbMocks.setTaskAssignee).toHaveBeenCalledWith(assignDb, "acct_1", TASK, STAFF_ID, "user_1", { expected: OTHER });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("an expected Unassigned is passed as null, not dropped (mutation: `expected ? … : …` -> FAILS)", async () => {
    expect(await setTaskAssigneeAction("acct_1", TASK, STAFF_ID, null)).toEqual({ ok: true, previous: STAFF_ID });
    expect(dbMocks.setTaskAssignee).toHaveBeenCalledWith(assignDb, "acct_1", TASK, STAFF_ID, "user_1", { expected: null });
  });
  it("an expected holder that is not a UUID is refused before anything is read", async () => {
    expect(await setTaskAssigneeAction("acct_1", TASK, STAFF_ID, "someone")).toEqual({ ok: false, error: "assign.failed" });
    expect(dbMocks.setTaskAssignee).not.toHaveBeenCalled();
  });
  it("a failed customer read is a failure, never a pass (mutation: treat a read error as no customer -> FAILS)", async () => {
    contactRead.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await setTaskAssigneeAction("acct_1", TASK, TECH_ID)).toEqual({ ok: false, error: "assign.failed" });
    expect(dbMocks.setTaskAssignee).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
