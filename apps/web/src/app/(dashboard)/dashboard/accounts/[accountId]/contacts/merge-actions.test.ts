import { describe, it, expect, vi, beforeEach } from "vitest";

// F-006 part 1 (plan Task 10, Step 3): merge, its Undo, and dismiss/undismiss of a possible-duplicate
// pair. Owner ruling D9: Owners, Staff and the agency; never a Technician. Same mock shape as
// archive-actions.test.ts: the guards, the request client and a bare @bis/db.

type Access = { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean };
const STAFF: Access = { userId: "user_1", isAgency: false, role: "staff", canManage: false };
const TECH: Access = { userId: "user_1", isAgency: false, role: "technician", canManage: false };
const requireAccountAccess = vi.fn<(accountId: string) => Promise<Access>>(async () => STAFF);
vi.mock("@/lib/auth", () => ({ requireAccountAccess: (accountId: string) => requireAccountAccess(accountId) }));

const REQUEST = { tag: "request-db" };
const dbForRequest = vi.fn(async () => REQUEST);
vi.mock("@/lib/db", () => ({ dbForRequest: () => dbForRequest() }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const dbMocks = {
  mergeContacts: vi.fn(), undoContactMerge: vi.fn(), dismissDuplicatePair: vi.fn(), undismissDuplicatePair: vi.fn(),
  MERGE_CHOICE_FIELDS: ["first_name", "last_name", "email", "phone", "assigned_to", "language"],
};
vi.mock("@bis/db", () => dbMocks);

const {
  mergeContactsAction, undoMergeAction, dismissPairAction, undismissPairAction,
} = await import("./merge-actions");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const KEEP = id(1), OTHER = id(2), FLAG = id(3);
const SEEN_KEEP = "a".repeat(32);
const SEEN_OTHER = "b".repeat(32);
const quietly = () => vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  requireAccountAccess.mockReset().mockResolvedValue(STAFF);
  dbForRequest.mockReset().mockResolvedValue(REQUEST);
});

describe("mergeContactsAction", () => {
  const input = { keepId: KEEP, otherId: OTHER, choices: { email: "other" as const, "custom.favoriteColor": "keep" as const }, seen: { keep: SEEN_KEEP, other: SEEN_OTHER } };

  it("passes the choices and seen unchanged, and reports the kept id, revalidating the list and both records (mutation: reformat choices -> FAILS)", async () => {
    dbMocks.mergeContacts.mockResolvedValue({ status: "merged", mergeId: 42, moved: { messages: 3 } });
    const r = await mergeContactsAction("a1", input);
    expect(r).toEqual({ ok: true, mergeId: 42, keptId: KEEP });
    expect(dbMocks.mergeContacts).toHaveBeenCalledWith(REQUEST, "a1", { keepId: KEEP, otherId: OTHER, choices: input.choices, seen: input.seen });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts");
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/accounts/a1/contacts/${KEEP}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/accounts/a1/contacts/${OTHER}`);
  });

  it("a Technician is refused by role before any db call (mutation: drop the seesWholeAccount check -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValueOnce(TECH);
    expect(await mergeContactsAction("a1", input)).toEqual({ ok: false, errorKey: "contacts.merge.failed" });
    expect(dbForRequest).not.toHaveBeenCalled();
    expect(dbMocks.mergeContacts).not.toHaveBeenCalled();
  });

  it("a non-uuid id is refused before any db call", async () => {
    expect(await mergeContactsAction("a1", { ...input, keepId: "not-a-uuid" })).toEqual({ ok: false, errorKey: "contacts.merge.failed" });
    expect(dbForRequest).not.toHaveBeenCalled();
  });

  it("an unknown choice key, a bad choice value, or a malformed seen fingerprint is refused before any db call", async () => {
    expect(await mergeContactsAction("a1", { ...input, choices: { nope: "keep" } })).toEqual({ ok: false, errorKey: "contacts.merge.failed" });
    expect(await mergeContactsAction("a1", { ...input, choices: { email: "sideways" as never } })).toEqual({ ok: false, errorKey: "contacts.merge.failed" });
    expect(await mergeContactsAction("a1", { ...input, seen: { keep: "too-short", other: SEEN_OTHER } })).toEqual({ ok: false, errorKey: "contacts.merge.failed" });
    expect(dbForRequest).not.toHaveBeenCalled();
  });

  it("stale answers its own key; nothing is revalidated", async () => {
    dbMocks.mergeContacts.mockResolvedValue({ status: "stale" });
    expect(await mergeContactsAction("a1", input)).toEqual({ ok: false, errorKey: "contacts.merge.stale" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("every other refusal, and a throw, answer contacts.merge.failed and log (mutation: swallow the throw silently -> FAILS)", async () => {
    const log = quietly();
    dbMocks.mergeContacts.mockResolvedValue({ status: "holding" });
    expect(await mergeContactsAction("a1", input)).toEqual({ ok: false, errorKey: "contacts.merge.failed" });
    dbMocks.mergeContacts.mockRejectedValue(new Error("boom"));
    expect(await mergeContactsAction("a1", input)).toEqual({ ok: false, errorKey: "contacts.merge.failed" });
    expect(log).toHaveBeenCalled();
  });
});

describe("undoMergeAction", () => {
  it("undone reports otherId, keptNew and keptEdits, and revalidates", async () => {
    dbMocks.undoContactMerge.mockResolvedValue({ status: "undone", otherId: OTHER, keptNew: 2, keptEdits: ["email"] });
    expect(await undoMergeAction("a1", 42)).toEqual({ ok: true, otherId: OTHER, keptNew: 2, keptEdits: ["email"] });
    expect(dbMocks.undoContactMerge).toHaveBeenCalledWith(REQUEST, "a1", 42);
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/accounts/a1/contacts/${OTHER}`);
  });
  it("expired and later_merge map to their own keys", async () => {
    dbMocks.undoContactMerge.mockResolvedValue({ status: "expired" });
    expect(await undoMergeAction("a1", 1)).toEqual({ ok: false, errorKey: "contacts.merge.undoExpired" });
    dbMocks.undoContactMerge.mockResolvedValue({ status: "later_merge" });
    expect(await undoMergeAction("a1", 1)).toEqual({ ok: false, errorKey: "contacts.merge.undoLater" });
  });
  it("not_found and a throw both answer contacts.merge.undoFailed", async () => {
    quietly();
    dbMocks.undoContactMerge.mockResolvedValue({ status: "not_found" });
    expect(await undoMergeAction("a1", 1)).toEqual({ ok: false, errorKey: "contacts.merge.undoFailed" });
    dbMocks.undoContactMerge.mockRejectedValue(new Error("boom"));
    expect(await undoMergeAction("a1", 1)).toEqual({ ok: false, errorKey: "contacts.merge.undoFailed" });
  });
  it("a Technician and a non-integer id are refused before any db call", async () => {
    requireAccountAccess.mockResolvedValueOnce(TECH);
    expect(await undoMergeAction("a1", 1)).toEqual({ ok: false, errorKey: "contacts.merge.undoFailed" });
    expect(await undoMergeAction("a1", 1.5)).toEqual({ ok: false, errorKey: "contacts.merge.undoFailed" });
    expect(dbForRequest).not.toHaveBeenCalled();
  });
});

describe("dismissPairAction / undismissPairAction", () => {
  it("dismissed/restored report ok; not_found reports the failure key", async () => {
    dbMocks.dismissDuplicatePair.mockResolvedValue("dismissed");
    expect(await dismissPairAction("a1", FLAG)).toEqual({ ok: true });
    expect(dbMocks.dismissDuplicatePair).toHaveBeenCalledWith(REQUEST, "a1", FLAG);
    dbMocks.undismissDuplicatePair.mockResolvedValue("restored");
    expect(await undismissPairAction("a1", FLAG)).toEqual({ ok: true });
    dbMocks.dismissDuplicatePair.mockResolvedValue("not_found");
    expect(await dismissPairAction("a1", FLAG)).toEqual({ ok: false, errorKey: "contacts.duplicates.dismissFailed" });
  });
  it("a Technician and a non-uuid flag id are refused before any db call (mutation: drop the role check -> a db call is recorded)", async () => {
    requireAccountAccess.mockResolvedValueOnce(TECH);
    expect(await dismissPairAction("a1", FLAG)).toEqual({ ok: false, errorKey: "contacts.duplicates.dismissFailed" });
    expect(await dismissPairAction("a1", "nope")).toEqual({ ok: false, errorKey: "contacts.duplicates.dismissFailed" });
    expect(dbForRequest).not.toHaveBeenCalled();
    expect(dbMocks.dismissDuplicatePair).not.toHaveBeenCalled();
  });
  it("a throw answers the failure key and logs", async () => {
    const log = quietly();
    dbMocks.dismissDuplicatePair.mockRejectedValue(new Error("boom"));
    expect(await dismissPairAction("a1", FLAG)).toEqual({ ok: false, errorKey: "contacts.duplicates.dismissFailed" });
    expect(log).toHaveBeenCalled();
  });
});

describe("no action opts out of the billing pause, and none reaches serviceDb", () => {
  it("none of the four actions passes duringPause to its guard (mutation: add it to mergeContactsAction -> FAILS)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("./merge-actions.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/duringPause:\s*"allow"/);
    expect(src).not.toMatch(/serviceDb\(/);
  });
});
