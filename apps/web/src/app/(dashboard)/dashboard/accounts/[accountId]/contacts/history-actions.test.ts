import { describe, it, expect, vi, beforeEach } from "vitest";

// F-115 Task 6 (plan Task 6 Step 3): putBackAction/restoreAction. @bis/db mocked bare, the same mock
// shape as archive-actions.test.ts: the guards, the request client and a bare @bis/db.

type Access = { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean };
const OWNER: Access = { userId: "user_1", isAgency: false, role: "owner", canManage: true };
const TECH: Access = { userId: "user_1", isAgency: false, role: "technician", canManage: false };
const requireAccountAccess = vi.fn<(accountId: string) => Promise<Access>>(async () => OWNER);
vi.mock("@/lib/auth", () => ({ requireAccountAccess: (accountId: string) => requireAccountAccess(accountId) }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

/** The request client: a fresh chainable query object per `.from()` call; `maybeSingle()` resolves
 *  from a queue in call order, so a test supplies exactly the answers its action invocation needs. */
const calls: { table: string; cols: string; filters: [string, unknown][] }[] = [];
const queue: { data: unknown; error: { message: string } | null }[] = [];
function queueAnswer(data: unknown) { queue.push({ data, error: null }); }
const REQUEST = {
  from: (table: string) => {
    const filters: [string, unknown][] = [];
    let cols = "";
    const chain = {
      select: (c: string) => { cols = c; return chain; },
      eq: (col: string, val: unknown) => { filters.push([col, val]); return chain; },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        calls.push({ table, cols, filters });
        return queue.shift() ?? { data: null, error: null };
      },
    };
    return chain;
  },
};
const dbForRequest = vi.fn(async () => REQUEST);
vi.mock("@/lib/db", () => ({ dbForRequest: () => dbForRequest() }));

const dbMocks = {
  putBackChange: vi.fn(), restoreRemoved: vi.fn(),
  parseChangeId: (v: number | string): number | null => {
    if (typeof v === "number") return Number.isSafeInteger(v) && v > 0 ? v : null;
    if (!/^[0-9]{1,19}$/.test(v)) return null;
    const n = Number(v);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  },
};
vi.mock("@bis/db", () => dbMocks);

const { putBackAction, restoreAction } = await import("./history-actions");

const EN = "en" as const;
const ES = "es" as const;
const quietly = () => vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  requireAccountAccess.mockReset().mockResolvedValue(OWNER);
  dbForRequest.mockReset().mockResolvedValue(REQUEST);
  calls.length = 0;
  queue.length = 0;
});

describe("putBackAction / restoreAction: who may (Q3's own role check, reused from archive-actions.ts)", () => {
  it("a Technician is refused before any db call at all (mutation: skip the role check -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(TECH);
    const r = await putBackAction("a1", EN, 42);
    expect(r).toEqual({ ok: false, message: "Only Owners and Staff can do this." });
    expect(dbForRequest).not.toHaveBeenCalled();
    expect(dbMocks.putBackChange).not.toHaveBeenCalled();
  });

  it("a Technician is refused before any db call for restoreAction too", async () => {
    requireAccountAccess.mockResolvedValue(TECH);
    const r = await restoreAction("a1", EN, 42);
    expect(r).toEqual({ ok: false, message: "Only Owners and Staff can do this." });
    expect(dbForRequest).not.toHaveBeenCalled();
    expect(dbMocks.restoreRemoved).not.toHaveBeenCalled();
  });

  it("Spanish wording for the same refusal", async () => {
    requireAccountAccess.mockResolvedValue(TECH);
    const r = await putBackAction("a1", ES, 42);
    expect(r).toEqual({ ok: false, message: "Solo el Dueño o un Empleado puede hacer esto." });
  });
});

describe("putBackAction: outcomes", () => {
  it("put_back: revalidates the contact's page and answers the new change row's id as the undo", async () => {
    queueAnswer({ id: 7, contact_id: "c1", client_group_id: null }); // readRecordRef
    dbMocks.putBackChange.mockResolvedValue("put_back");
    queueAnswer({ id: 99 }); // latestViaRowId
    const r = await putBackAction("a1", EN, 7);
    expect(r).toEqual({ ok: true, undo: { changeId: 99 } });
    expect(dbMocks.putBackChange).toHaveBeenCalledWith(REQUEST, "a1", 7, { authorKind: "person", authorId: "user_1" });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts/c1");
  });

  it("put_back on a group row revalidates the group's page too", async () => {
    queueAnswer({ id: 7, contact_id: null, client_group_id: "g1" });
    dbMocks.putBackChange.mockResolvedValue("put_back");
    queueAnswer(null);
    const r = await putBackAction("a1", EN, 7);
    expect(r.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/groups/g1");
  });

  it("changed: EN and ES", async () => {
    queueAnswer({ id: 7, contact_id: "c1", client_group_id: null });
    dbMocks.putBackChange.mockResolvedValue("changed");
    expect(await putBackAction("a1", EN, 7)).toEqual({ ok: false, message: "It changed since, so it wasn't put back." });
    queueAnswer({ id: 7, contact_id: "c1", client_group_id: null });
    expect(await putBackAction("a1", ES, 7)).toEqual({ ok: false, message: "Cambió desde entonces; no se restauró." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("not_found from the function, and a malformed changeId, both answer history.notFound without calling putBackChange for the latter", async () => {
    queueAnswer({ id: 7, contact_id: "c1", client_group_id: null });
    dbMocks.putBackChange.mockResolvedValue("not_found");
    expect(await putBackAction("a1", EN, 7)).toEqual({ ok: false, message: "This change can no longer be found." });

    const r2 = await putBackAction("a1", EN, "12345678901234567890"); // 20 digits: refused before any read
    expect(r2).toEqual({ ok: false, message: "This change can no longer be found." });
    expect(dbMocks.putBackChange).toHaveBeenCalledTimes(1); // not called again for the malformed id
  });

  it("a thrown error is caught and answers history.notFound, logged, never rethrown", async () => {
    const spy = quietly();
    queueAnswer({ id: 7, contact_id: "c1", client_group_id: null });
    dbMocks.putBackChange.mockRejectedValue(new Error("boom"));
    const r = await putBackAction("a1", EN, 7);
    expect(r).toEqual({ ok: false, message: "This change can no longer be found." });
    expect(spy).toHaveBeenCalled();
  });
});

describe("restoreAction: outcomes", () => {
  it("restored: revalidates and answers the undo id", async () => {
    queueAnswer({ id: 7, contact_id: "c1", client_group_id: null });
    dbMocks.restoreRemoved.mockResolvedValue("restored");
    queueAnswer({ id: 100 });
    const r = await restoreAction("a1", EN, 7);
    expect(r).toEqual({ ok: true, undo: { changeId: 100 } });
    expect(dbMocks.restoreRemoved).toHaveBeenCalledWith(REQUEST, "a1", 7, { authorKind: "person", authorId: "user_1" }, expect.any(Date));
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts/c1");
  });

  it("expired, parent_gone, already_back: EN and ES", async () => {
    const cases: [string, string, string][] = [
      ["expired", "This could be restored for 30 days. That time has passed.", "Esto se podía restaurar durante 30 días. Ese plazo ya pasó."],
      ["parent_gone", "It can't be restored: what it belonged to was removed.", "No se puede restaurar: lo que lo contenía ya no existe."],
      ["already_back", "It's already back.", "Ya está restaurado."],
    ];
    for (const [outcome, en, es] of cases) {
      queueAnswer({ id: 7, contact_id: "c1", client_group_id: null });
      dbMocks.restoreRemoved.mockResolvedValue(outcome);
      expect(await restoreAction("a1", EN, 7)).toEqual({ ok: false, message: en });
      queueAnswer({ id: 7, contact_id: "c1", client_group_id: null });
      expect(await restoreAction("a1", ES, 7)).toEqual({ ok: false, message: es });
    }
  });
});

describe(".bind() shape", () => {
  it("binds accountId then locale, leaving changeId for the call site", async () => {
    queueAnswer({ id: 7, contact_id: "c1", client_group_id: null });
    dbMocks.putBackChange.mockResolvedValue("put_back");
    queueAnswer(null);
    const bound = putBackAction.bind(null, "a1", EN);
    const r = await bound(7);
    expect(r).toEqual({ ok: true, undo: { changeId: null } });
  });
});
