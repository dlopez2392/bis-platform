import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Not needed / Needed again (spec 5.4; D1; the actor's own Undo). One shared call log tags every
 * database call with the client it ran on, so "the request client's proof first" is an ORDER
 * assertion on one list, never two toHaveBeenCalled's.
 */
type Access = { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean };
const calls: string[] = [];
const requireAccountAccess = vi.fn<(id: string) => Promise<Access>>();
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: (id: string) => { calls.push("requireAccountAccess"); return requireAccountAccess(id); },
}));
const REQUEST = { tag: "request" };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));
const SVC = { tag: "service" };
const tagOf = (c: unknown) => (c as { tag?: string } | null)?.tag ?? "?";
const spy = () => vi.fn<(...a: unknown[]) => Promise<unknown>>();
const h = {
  getContact: spy(), getRequiredDocumentCategories: spy(), skipDocumentRequirement: spy(), getDocumentSkip: spy(),
  undoDocumentSkip: spy(), getActiveDocumentSkip: spy(), unskipDocumentRequirement: spy(), undoDocumentUnskip: spy(),
};
const serviceDb = vi.fn(() => { calls.push("serviceDb"); return SVC; });
/** Every spy records `<name>:<client tag>` before answering. */
const wrap = (name: keyof typeof h) => (...a: unknown[]) => { calls.push(`${name}:${tagOf(a[0])}`); return h[name](...a); };
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return {
    ...real, serviceDb: () => serviceDb(),
    getContact: wrap("getContact"), getRequiredDocumentCategories: wrap("getRequiredDocumentCategories"),
    skipDocumentRequirement: wrap("skipDocumentRequirement"), getDocumentSkip: wrap("getDocumentSkip"),
    undoDocumentSkip: wrap("undoDocumentSkip"), getActiveDocumentSkip: wrap("getActiveDocumentSkip"),
    unskipDocumentRequirement: wrap("unskipDocumentRequirement"), undoDocumentUnskip: wrap("undoDocumentUnskip"),
  };
});
const A = await import("./document-requirements-actions");

const ACC = "44444444-4444-4444-8444-444444444444";
const C = "11111111-1111-4111-8111-111111111111";
const S = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-16T15:00:00.000Z");
const STAFF: Access = { userId: "user_me", isAgency: false, role: "staff", canManage: false };
const TECH: Access = { userId: "user_me", isAgency: false, role: "technician", canManage: false };
const UNSKIPPED_AT = "2026-10-16T15:00:00.123456+00:00";
const skipRow = (over: Record<string, unknown> = {}) => ({
  id: S, account_id: ACC, contact_id: C, category: "insurance", skipped_by: "user_me", created_at: "2026-10-16T14:55:00.000Z",
  unskipped_at: null, unskipped_by: null, ...over,
});
const writes = () => calls.filter((c) => c.endsWith(":service") || c === "serviceDb");

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireAccountAccess.mockResolvedValue(STAFF);
  h.getContact.mockResolvedValue({ id: C });
  h.getRequiredDocumentCategories.mockResolvedValue(["id", "insurance"]);
  h.skipDocumentRequirement.mockResolvedValue({ status: "skipped", skip: skipRow() });
  h.getDocumentSkip.mockResolvedValue(skipRow());
  h.undoDocumentSkip.mockResolvedValue(true);
  h.getActiveDocumentSkip.mockResolvedValue(skipRow());
  h.unskipDocumentRequirement.mockResolvedValue({ unskippedAt: UNSKIPPED_AT });
  h.undoDocumentUnskip.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

describe("Not needed: skipDocumentRequirementAction", () => {
  it("proves the contact and the list on the request client, then writes on the service client (mutation: write before the proof -> FAILS)", async () => {
    expect(await A.skipDocumentRequirementAction(ACC, C.toUpperCase(), "insurance")).toEqual({ ok: true, skipId: S });
    expect(calls).toEqual([
      "requireAccountAccess", "getContact:request", "getRequiredDocumentCategories:request", "serviceDb", "skipDocumentRequirement:service",
    ]);
    expect(h.getContact).toHaveBeenCalledWith(REQUEST, ACC, C);
    expect(h.getRequiredDocumentCategories).toHaveBeenCalledWith(REQUEST, ACC);
    expect(h.skipDocumentRequirement).toHaveBeenCalledWith(SVC, { accountId: ACC, contactId: C, category: "insurance", actorId: "user_me" });
  });
  it("a Technician may not skip, and nothing is read or written (D1; mutation: skip the role check -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(TECH);
    expect(await A.skipDocumentRequirementAction(ACC, C, "insurance")).toEqual({ ok: false, error: "documents.checklist.skipRole" });
    expect(calls).toEqual(["requireAccountAccess"]);
  });
  it("an unsettled client role is treated as a Technician (fails closed)", async () => {
    requireAccountAccess.mockResolvedValue({ ...STAFF, role: null });
    expect(await A.skipDocumentRequirementAction(ACC, C, "insurance")).toEqual({ ok: false, error: "documents.checklist.skipRole" });
    expect(writes()).toEqual([]);
  });
  it("the agency and an Owner may skip", async () => {
    requireAccountAccess.mockResolvedValue({ userId: "user_me", isAgency: true, role: null, canManage: true });
    expect(await A.skipDocumentRequirementAction(ACC, C, "insurance")).toEqual({ ok: true, skipId: S });
    requireAccountAccess.mockResolvedValue({ userId: "user_me", isAgency: false, role: "owner", canManage: true });
    expect(await A.skipDocumentRequirementAction(ACC, C, "insurance")).toEqual({ ok: true, skipId: S });
  });
  it("a malformed contact id, an unknown category or Other is the checklist's own refusal, never 2b's (M2), with nothing read", async () => {
    for (const [id, cat] of [["nope", "insurance"], [C, "passport"], [C, "other"], [C, 7 as unknown as string]] as const) {
      expect(await A.skipDocumentRequirementAction(ACC, id, cat)).toEqual({ ok: false, error: "documents.checklist.refused" });
    }
    expect(calls.filter((c) => c !== "requireAccountAccess")).toEqual([]);
  });
  it("a contact the caller cannot see is not found, and nothing is written", async () => {
    h.getContact.mockResolvedValue(null);
    expect(await A.skipDocumentRequirementAction(ACC, C, "insurance")).toEqual({ ok: false, error: "documents.error.notFound" });
    expect(writes()).toEqual([]);
  });
  it("a category no longer on the account's list is refused, and nothing is written", async () => {
    h.getRequiredDocumentCategories.mockResolvedValue(["id"]);
    expect(await A.skipDocumentRequirementAction(ACC, C, "insurance")).toEqual({ ok: false, error: "documents.checklist.notRequired" });
    expect(writes()).toEqual([]);
  });
  it("an already-skipped item is 'changed first'", async () => {
    h.skipDocumentRequirement.mockResolvedValue({ status: "already" });
    expect(await A.skipDocumentRequirementAction(ACC, C, "insurance")).toEqual({ ok: false, error: "documents.checklist.changed" });
  });
  it("a thrown read is the generic failure, with nothing written", async () => {
    h.getRequiredDocumentCategories.mockRejectedValue(new Error("down"));
    expect(await A.skipDocumentRequirementAction(ACC, C, "insurance")).toEqual({ ok: false, error: "documents.error.failed" });
    expect(writes()).toEqual([]);
  });
});

describe("Undo a skip: undoSkipDocumentRequirementAction (the actor's own, within the window)", () => {
  it("reads the skip on the request client first, then deletes it on the service client", async () => {
    expect(await A.undoSkipDocumentRequirementAction(ACC, S)).toEqual({ ok: true });
    expect(calls).toEqual(["requireAccountAccess", "getDocumentSkip:request", "serviceDb", "undoDocumentSkip:service"]);
    expect(h.getDocumentSkip).toHaveBeenCalledWith(REQUEST, ACC, S);
    expect(h.undoDocumentSkip).toHaveBeenCalledWith(SVC, ACC, S, "user_me");
  });
  it("refuses, writing nothing, when the row is gone, someone else skipped it, it was un-skipped, or a malformed id (mutation: check skipped_by after the write -> FAILS)", async () => {
    for (const answer of [null, skipRow({ skipped_by: "user_other" }), skipRow({ unskipped_at: "2026-10-16T14:58:00Z", unskipped_by: "user_me" })]) {
      h.getDocumentSkip.mockResolvedValueOnce(answer);
      expect((await A.undoSkipDocumentRequirementAction(ACC, S)).ok).toBe(false);
    }
    expect(await A.undoSkipDocumentRequirementAction(ACC, "nope")).toEqual({ ok: false, error: "documents.checklist.refused" });
    expect(writes()).toEqual([]);
  });
  it("refuses past the window, writing nothing (mutation: no window -> the 11-minute case writes -> FAILS)", async () => {
    h.getDocumentSkip.mockResolvedValue(skipRow({ created_at: new Date(NOW.getTime() - 11 * 60_000).toISOString() }));
    expect(await A.undoSkipDocumentRequirementAction(ACC, S)).toEqual({ ok: false, error: "documents.checklist.changed" });
    expect(writes()).toEqual([]);
  });
  it("a delete that found nothing (a race) is 'changed first'; a thrown read is the generic failure", async () => {
    h.undoDocumentSkip.mockResolvedValue(false);
    expect(await A.undoSkipDocumentRequirementAction(ACC, S)).toEqual({ ok: false, error: "documents.checklist.changed" });
    h.getDocumentSkip.mockRejectedValue(new Error("down"));
    expect(await A.undoSkipDocumentRequirementAction(ACC, S)).toEqual({ ok: false, error: "documents.error.failed" });
  });
  it("a Technician may not undo either (D1)", async () => {
    requireAccountAccess.mockResolvedValue(TECH);
    expect(await A.undoSkipDocumentRequirementAction(ACC, S)).toEqual({ ok: false, error: "documents.checklist.skipRole" });
    expect(calls).toEqual(["requireAccountAccess"]);
  });
});

describe("Needed again: unskipDocumentRequirementAction", () => {
  it("proves the contact and the active skip on the request client, then un-skips, answering the db's own instant (mutation: answer new Date().toISOString() -> FAILS)", async () => {
    expect(await A.unskipDocumentRequirementAction(ACC, C, "insurance")).toEqual({ ok: true, skipId: S, unskippedAt: UNSKIPPED_AT });
    expect(calls).toEqual([
      "requireAccountAccess", "getContact:request", "getActiveDocumentSkip:request", "serviceDb", "unskipDocumentRequirement:service",
    ]);
    expect(h.getActiveDocumentSkip).toHaveBeenCalledWith(REQUEST, ACC, C, "insurance");
    expect(h.unskipDocumentRequirement).toHaveBeenCalledWith(SVC, ACC, S, "user_me");
  });
  it("no active skip, or a compare-and-set that lost, is 'changed first'", async () => {
    h.getActiveDocumentSkip.mockResolvedValueOnce(null);
    expect(await A.unskipDocumentRequirementAction(ACC, C, "insurance")).toEqual({ ok: false, error: "documents.checklist.changed" });
    expect(writes()).toEqual([]);
    h.unskipDocumentRequirement.mockResolvedValueOnce(null);
    expect(await A.unskipDocumentRequirementAction(ACC, C, "insurance")).toEqual({ ok: false, error: "documents.checklist.changed" });
  });
  it("a Technician may not; a hidden contact is not found; a bad category is refused; each writing nothing", async () => {
    requireAccountAccess.mockResolvedValueOnce(TECH);
    expect(await A.unskipDocumentRequirementAction(ACC, C, "insurance")).toEqual({ ok: false, error: "documents.checklist.skipRole" });
    h.getContact.mockResolvedValueOnce(null);
    expect(await A.unskipDocumentRequirementAction(ACC, C, "insurance")).toEqual({ ok: false, error: "documents.error.notFound" });
    expect(await A.unskipDocumentRequirementAction(ACC, C, "other")).toEqual({ ok: false, error: "documents.checklist.refused" });
    expect(writes()).toEqual([]);
  });
});

describe("Undo Needed again: undoUnskipDocumentRequirementAction (the actor's own un-skip, at the instant its toast named)", () => {
  const unskipped = (over: Record<string, unknown> = {}) => skipRow({ unskipped_at: UNSKIPPED_AT, unskipped_by: "user_me", ...over });
  beforeEach(() => { h.getDocumentSkip.mockResolvedValue(unskipped()); });
  it("restores with the ARGUMENT's instant on the service client after the request-client read (mutation: pass new Date().toISOString() -> FAILS)", async () => {
    expect(await A.undoUnskipDocumentRequirementAction(ACC, S, UNSKIPPED_AT)).toEqual({ ok: true });
    expect(calls).toEqual(["requireAccountAccess", "getDocumentSkip:request", "serviceDb", "undoDocumentUnskip:service"]);
    expect(h.undoDocumentUnskip).toHaveBeenCalledWith(SVC, ACC, S, UNSKIPPED_AT, "user_me");
  });
  it("refuses, writing nothing: someone else's un-skip, a different instant, an active row, or a gone row", async () => {
    for (const answer of [
      unskipped({ unskipped_by: "user_other" }), unskipped({ unskipped_at: "2026-10-16T14:59:00+00:00" }), skipRow(), null,
    ]) {
      h.getDocumentSkip.mockResolvedValueOnce(answer);
      expect(await A.undoUnskipDocumentRequirementAction(ACC, S, UNSKIPPED_AT)).toEqual({ ok: false, error: "documents.checklist.changed" });
    }
    expect(writes()).toEqual([]);
  });
  it("accepts the same instant written another way (the toast's string parses equal), and refuses past the window (mutation: no window -> FAILS)", async () => {
    h.getDocumentSkip.mockResolvedValueOnce(unskipped({ unskipped_at: "2026-10-16T14:59:00+00:00" }));
    expect(await A.undoUnskipDocumentRequirementAction(ACC, S, "2026-10-16T14:59:00.000Z")).toEqual({ ok: true });
    const old = "2026-10-16T14:49:00+00:00";
    h.getDocumentSkip.mockResolvedValueOnce(unskipped({ unskipped_at: old }));
    calls.length = 0;
    expect(await A.undoUnskipDocumentRequirementAction(ACC, S, old)).toEqual({ ok: false, error: "documents.checklist.changed" });
    expect(writes()).toEqual([]);
  });
  it("a malformed instant or skip id is refused with no read (M2)", async () => {
    expect(await A.undoUnskipDocumentRequirementAction(ACC, S, "yesterday")).toEqual({ ok: false, error: "documents.checklist.refused" });
    expect(await A.undoUnskipDocumentRequirementAction(ACC, "nope", UNSKIPPED_AT)).toEqual({ ok: false, error: "documents.checklist.refused" });
    expect(calls.filter((c) => c !== "requireAccountAccess")).toEqual([]);
  });
  it("a restore that found nothing (a race, or a newer skip) is 'changed first'", async () => {
    h.undoDocumentUnskip.mockResolvedValue(false);
    expect(await A.undoUnskipDocumentRequirementAction(ACC, S, UNSKIPPED_AT)).toEqual({ ok: false, error: "documents.checklist.changed" });
  });
});
