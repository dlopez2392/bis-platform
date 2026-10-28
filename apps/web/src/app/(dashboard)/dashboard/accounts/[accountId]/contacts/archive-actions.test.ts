import { describe, it, expect, vi, beforeEach } from "vitest";

// Contact archive (plan Task 10; owner rulings 2026-10-28): Archive and Restore for Owners, Staff and the
// agency, never a Technician; the delete dialog's "which of these can go" read for the Owner. Same mock
// shape as actions.test.ts: the guards, the request client and a bare @bis/db.

type Access = { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean };
const STAFF: Access = { userId: "user_1", isAgency: false, role: "staff", canManage: false };
const TECH: Access = { userId: "user_1", isAgency: false, role: "technician", canManage: false };
const UNSETTLED: Access = { userId: "user_1", isAgency: false, role: null, canManage: false };
const requireAccountAccess = vi.fn<(accountId: string) => Promise<Access>>(async () => STAFF);
const requireAccountOwner = vi.fn<(accountId: string, opts?: { duringPause?: "allow" }) => Promise<{ userId: string; isAgency: boolean }>>(
  async () => ({ userId: "user_1", isAgency: false }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: (accountId: string) => requireAccountAccess(accountId),
  requireAccountOwner: (...a: [string, { duringPause?: "allow" }?]) => requireAccountOwner(...a),
}));

/** The request client: answers the delete dialog's proof read (`contacts` by id) from `REQUEST_ROWS`. */
const REQUEST_ROWS = { ids: [] as string[], error: null as { message: string } | null };
const proofReads: { table: string; eq: [string, string]; ids: string[] }[] = [];
const REQUEST = {
  tag: "request-db",
  from: (table: string) => ({
    select: () => ({
      eq: (col: string, val: string) => ({
        in: async (_col: string, ids: string[]) => {
          proofReads.push({ table, eq: [col, val], ids });
          if (REQUEST_ROWS.error) return { data: null, error: REQUEST_ROWS.error };
          return { data: ids.filter((id) => REQUEST_ROWS.ids.includes(id)).map((id) => ({ id })), error: null };
        },
      }),
    }),
  }),
};
const dbForRequest = vi.fn(async () => REQUEST);
vi.mock("@/lib/db", () => ({ dbForRequest: () => dbForRequest() }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const SERVICE = { tag: "service-db" };
const hoisted = vi.hoisted(() => {
  class ContactBatchError extends Error {
    readonly changedIds: string[];
    constructor(message: string, changedIds: string[]) { super(message); this.changedIds = changedIds; }
  }
  return { ContactBatchError };
});
const dbMocks = {
  archiveContacts: vi.fn(), restoreContacts: vi.fn(), contactDeleteBlockers: vi.fn(),
  listContactUpcomingBookings: vi.fn(), serviceDb: vi.fn(() => SERVICE),
  MAX_CONTACT_BATCH: 500, ContactBatchError: hoisted.ContactBatchError,
};
vi.mock("@bis/db", () => dbMocks);

const { archiveContactsAction, restoreContactsAction, contactDeleteBlockersAction } = await import("./archive-actions");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const C1 = id(1), C2 = id(2), C3 = id(3), C4 = id(4);
const quietly = () => vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  requireAccountAccess.mockReset().mockResolvedValue(STAFF);
  requireAccountOwner.mockReset().mockResolvedValue({ userId: "user_1", isAgency: false });
  dbForRequest.mockReset().mockResolvedValue(REQUEST);
  dbMocks.listContactUpcomingBookings.mockReset().mockResolvedValue([]);
  REQUEST_ROWS.ids = [];
  REQUEST_ROWS.error = null;
  proofReads.length = 0;
});

describe("archiveContactsAction: who may archive (owner ruling Q3)", () => {
  it("Staff archives at once and gets back exactly the ids that changed, for the Undo (and the list is revalidated)", async () => {
    dbMocks.archiveContacts.mockResolvedValue({ changedIds: [C1] });
    const r = await archiveContactsAction("a1", [C1, C2]);
    expect(r).toEqual({ ok: true, changedIds: [C1], nextAppointment: null, withAppointments: 0 });
    expect(dbMocks.archiveContacts).toHaveBeenCalledWith(REQUEST, "a1", [C1, C2]);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts");
  });

  it("a Technician is refused BY ROLE before any db call: the database would answer 0 rows with no error (mutation: drop the seesWholeAccount check -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValueOnce(TECH);
    dbMocks.archiveContacts.mockResolvedValue({ changedIds: [] });
    expect(await archiveContactsAction("a1", [C1])).toEqual({ ok: false, errorKey: "contacts.archive.failed" });
    expect(dbMocks.archiveContacts).not.toHaveBeenCalled();
    expect(dbForRequest).not.toHaveBeenCalled();
  });

  it("a client whose role could not be settled is refused too (fails closed, like the database)", async () => {
    requireAccountAccess.mockResolvedValueOnce(UNSETTLED);
    expect(await archiveContactsAction("a1", [C1])).toEqual({ ok: false, errorKey: "contacts.archive.failed" });
    expect(dbMocks.archiveContacts).not.toHaveBeenCalled();
  });

  it("the guard's redirect is rejected as-is, never swallowed into a failure", async () => {
    const denied = new Error("NEXT_REDIRECT");
    requireAccountAccess.mockRejectedValueOnce(denied);
    await expect(archiveContactsAction("a1", [C1])).rejects.toBe(denied);
    expect(dbMocks.archiveContacts).not.toHaveBeenCalled();
  });
});

describe("archiveContactsAction: what it accepts", () => {
  it("non-UUID ids, an empty list, a non-array and 501 ids are refused before any db call (mutation: drop the cap -> FAILS)", async () => {
    dbMocks.archiveContacts.mockResolvedValue({ changedIds: [] });
    const many = Array.from({ length: 501 }, (_, i) => id(i + 1));
    for (const ids of [["not-a-uuid"], [], "nope" as unknown as string[], many]) {
      expect(await archiveContactsAction("a1", ids)).toEqual({ ok: false, errorKey: "contacts.archive.failed" });
    }
    expect(dbMocks.archiveContacts).not.toHaveBeenCalled();
    expect(dbForRequest).not.toHaveBeenCalled();
  });

  it("exactly 500 ids go through, lower-cased", async () => {
    dbMocks.archiveContacts.mockResolvedValue({ changedIds: [] });
    const five = Array.from({ length: 500 }, (_, i) => id(i + 1));
    expect((await archiveContactsAction("a1", five)).ok).toBe(true);
    await archiveContactsAction("a1", ["AAAAAAAA-0000-4000-8000-000000000001"]);
    expect(dbMocks.archiveContacts.mock.calls[1]![2]).toEqual(["aaaaaaaa-0000-4000-8000-000000000001"]);
  });
});

describe("archiveContactsAction: an appointment stays, and the toast says so (owner ruling Q2)", () => {
  const BOOKINGS = [
    { id: "b1", contact_id: C1, starts_at: "2026-11-03T15:00:00Z" },
    { id: "b0", contact_id: C1, starts_at: "2026-11-02T15:00:00Z" },
    { id: "b2", contact_id: C2, starts_at: "2026-11-05T15:00:00Z" },
    { id: "b4", contact_id: C4, starts_at: "2026-11-04T15:00:00Z" },
  ];
  const fromFixture = async (_db: unknown, _a: string, ids: readonly string[]) =>
    BOOKINGS.filter((b) => ids.includes(b.contact_id));

  it("one archived contact with an upcoming booking answers nextAppointment with its SOONEST startsAt", async () => {
    dbMocks.archiveContacts.mockResolvedValue({ changedIds: [C1] });
    dbMocks.listContactUpcomingBookings.mockImplementation(fromFixture);
    const r = await archiveContactsAction("a1", [C1]);
    expect(r).toEqual({ ok: true, changedIds: [C1], nextAppointment: { contactId: C1, startsAt: "2026-11-02T15:00:00Z" }, withAppointments: 1 });
    expect(dbMocks.listContactUpcomingBookings.mock.calls[0]![0]).toBe(REQUEST);
  });

  it("counts the contacts THIS archive changed that have one, never the whole selection (mutation: read bookings for contactIds, not changedIds -> FAILS)", async () => {
    // C4 was already archived, so it did not change: its booking is not this archive's news.
    dbMocks.archiveContacts.mockResolvedValue({ changedIds: [C1, C2, C3] });
    dbMocks.listContactUpcomingBookings.mockImplementation(fromFixture);
    const r = await archiveContactsAction("a1", [C1, C2, C3, C4]);
    expect(r).toEqual({ ok: true, changedIds: [C1, C2, C3], nextAppointment: null, withAppointments: 2 });
  });

  it("nothing changed reads no bookings at all", async () => {
    dbMocks.archiveContacts.mockResolvedValue({ changedIds: [] });
    expect(await archiveContactsAction("a1", [C1])).toEqual({ ok: true, changedIds: [], nextAppointment: null, withAppointments: 0 });
    expect(dbMocks.listContactUpcomingBookings).not.toHaveBeenCalled();
  });

  it("reads the bookings at most 200 ids at a time (review M1)", async () => {
    const changed = Array.from({ length: 450 }, (_, i) => id(i + 1));
    dbMocks.archiveContacts.mockResolvedValue({ changedIds: changed });
    await archiveContactsAction("a1", changed);
    const sizes = dbMocks.listContactUpcomingBookings.mock.calls.map((c) => (c[2] as string[]).length);
    expect(sizes).toEqual([200, 200, 50]);
    expect(dbMocks.listContactUpcomingBookings.mock.calls.flatMap((c) => c[2] as string[])).toEqual(changed);
  });

  it("a failed bookings read loses only the toast's appointment line: the archive still answers ok with its Undo (logged)", async () => {
    const errors = quietly();
    dbMocks.archiveContacts.mockResolvedValue({ changedIds: [C1] });
    dbMocks.listContactUpcomingBookings.mockRejectedValue(new Error("bookings down"));
    expect(await archiveContactsAction("a1", [C1])).toEqual({ ok: true, changedIds: [C1], nextAppointment: null, withAppointments: 0 });
    expect(errors.mock.calls.map((c) => String(c[0])).join("\n")).toContain("bookings down");
    errors.mockRestore();
  });
});

describe("archiveContactsAction: a failure", () => {
  it("a plain failure is contacts.archive.failed (logged)", async () => {
    const errors = quietly();
    dbMocks.archiveContacts.mockRejectedValue(new Error("db down"));
    expect(await archiveContactsAction("a1", [C1])).toEqual({ ok: false, errorKey: "contacts.archive.failed" });
    errors.mockRestore();
  });

  it("a batch that failed AFTER earlier batches archived some still offers Undo for exactly those, and refreshes the list (fix round: ContactBatchError; mutation: answer a bare failure -> FAILS)", async () => {
    const errors = quietly();
    dbMocks.archiveContacts.mockRejectedValue(new dbMocks.ContactBatchError("archiveContacts failed: timeout", [C1, C2]));
    const r = await archiveContactsAction("a1", [C1, C2, C3]);
    // Task 10 review I2: partial, so the bar says the rest did not go (mutation: drop partial -> FAILS).
    expect(r).toMatchObject({ ok: true, changedIds: [C1, C2], partial: true });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts");
    errors.mockRestore();
  });

  it("a batch error before anything changed is the plain failure", async () => {
    const errors = quietly();
    dbMocks.archiveContacts.mockRejectedValue(new dbMocks.ContactBatchError("archiveContacts failed: timeout", []));
    expect(await archiveContactsAction("a1", [C1])).toEqual({ ok: false, errorKey: "contacts.archive.failed" });
    errors.mockRestore();
  });
});

describe("restoreContactsAction", () => {
  it("Staff restores and gets back exactly the ids that changed (and the list is revalidated)", async () => {
    dbMocks.restoreContacts.mockResolvedValue({ changedIds: [C2] });
    expect(await restoreContactsAction("a1", [C1, C2])).toEqual({ ok: true, changedIds: [C2], nextAppointment: null, withAppointments: 0 });
    expect(dbMocks.restoreContacts).toHaveBeenCalledWith(REQUEST, "a1", [C1, C2]);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts");
  });

  it("a Technician is refused by role before any db call (mutation: drop the seesWholeAccount check -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValueOnce(TECH);
    dbMocks.restoreContacts.mockResolvedValue({ changedIds: [] });
    expect(await restoreContactsAction("a1", [C1])).toEqual({ ok: false, errorKey: "contacts.restore.failed" });
    expect(dbMocks.restoreContacts).not.toHaveBeenCalled();
  });

  it("refuses bad ids and 501 ids before any db call", async () => {
    const many = Array.from({ length: 501 }, (_, i) => id(i + 1));
    for (const ids of [["x"], [], many]) {
      expect(await restoreContactsAction("a1", ids)).toEqual({ ok: false, errorKey: "contacts.restore.failed" });
    }
    expect(dbMocks.restoreContacts).not.toHaveBeenCalled();
  });

  it("a partial batch failure still answers the ids restored; a plain one is contacts.restore.failed", async () => {
    const errors = quietly();
    dbMocks.restoreContacts.mockRejectedValueOnce(new dbMocks.ContactBatchError("restoreContacts failed", [C1]));
    expect(await restoreContactsAction("a1", [C1, C2])).toMatchObject({ ok: true, changedIds: [C1], partial: true });
    dbMocks.restoreContacts.mockRejectedValueOnce(new Error("db down"));
    expect(await restoreContactsAction("a1", [C1])).toEqual({ ok: false, errorKey: "contacts.restore.failed" });
    errors.mockRestore();
  });
});

describe("contactDeleteBlockersAction (spec §5.4)", () => {
  it("is Owner-only: the guard's redirect is rejected as-is and nothing is read (mutation: requireAccountAccess as the guard -> FAILS)", async () => {
    const denied = new Error("REDIRECT:/dashboard/accounts/a1/dashboard");
    requireAccountOwner.mockRejectedValueOnce(denied);
    await expect(contactDeleteBlockersAction("a1", [C1])).rejects.toBe(denied);
    // Usable while paused, like the file count (lib/billing/read-only.test.ts lists it): the delete it prepares is refused then.
    expect(requireAccountOwner).toHaveBeenCalledWith("a1", { duringPause: "allow" });
    expect(dbMocks.contactDeleteBlockers).not.toHaveBeenCalled();
    expect(proofReads).toEqual([]);
  });

  it("proves the ids on the REQUEST client first and hands only the proven ones to the SERVICE client's read (mutation: pass the raw ids -> FAILS)", async () => {
    REQUEST_ROWS.ids = [C1, C3];
    dbMocks.contactDeleteBlockers.mockResolvedValue(new Map([[C3, ["messages", "bookings"]]]));
    const r = await contactDeleteBlockersAction("a1", [C1, C2, C3]);
    expect(r).toEqual({ ok: true, blocked: { [C3]: ["messages", "bookings"] } });
    expect(proofReads).toEqual([{ table: "contacts", eq: ["account_id", "a1"], ids: [C1, C2, C3] }]);
    expect(dbMocks.contactDeleteBlockers).toHaveBeenCalledWith(SERVICE, "a1", [C1, C3]);
  });

  it("the proof read goes at most 200 ids at a time (review M1)", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => id(i + 1));
    REQUEST_ROWS.ids = ids;
    dbMocks.contactDeleteBlockers.mockResolvedValue(new Map());
    await contactDeleteBlockersAction("a1", ids);
    expect(proofReads.map((p) => p.ids.length)).toEqual([200, 200, 50]);
    expect(dbMocks.contactDeleteBlockers.mock.calls[0]![2]).toEqual(ids);
  });

  it("bad ids, an empty list and 501 ids are ok:false before any read", async () => {
    const many = Array.from({ length: 501 }, (_, i) => id(i + 1));
    for (const ids of [["x"], [], many]) expect(await contactDeleteBlockersAction("a1", ids)).toEqual({ ok: false });
    expect(proofReads).toEqual([]);
    expect(dbMocks.contactDeleteBlockers).not.toHaveBeenCalled();
  });

  it("a failed proof read or blockers read is ok:false, never an empty 'nothing blocks' answer (logged)", async () => {
    const errors = quietly();
    REQUEST_ROWS.error = { message: "rls down" };
    expect(await contactDeleteBlockersAction("a1", [C1])).toEqual({ ok: false });
    expect(dbMocks.contactDeleteBlockers).not.toHaveBeenCalled();
    REQUEST_ROWS.error = null;
    REQUEST_ROWS.ids = [C1];
    dbMocks.contactDeleteBlockers.mockRejectedValue(new Error("contactDeleteBlockers failed: no answer"));
    expect(await contactDeleteBlockersAction("a1", [C1])).toEqual({ ok: false });
    errors.mockRestore();
  });
});
