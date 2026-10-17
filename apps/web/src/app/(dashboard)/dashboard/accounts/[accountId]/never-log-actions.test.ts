import { describe, it, expect, vi, beforeEach } from "vitest";

const order: string[] = [];
const db = vi.hoisted(() => ({ addNeverLog: vi.fn(), removeNeverLog: vi.fn(), serviceDb: vi.fn(() => ({ svc: true })) }));
vi.mock("@bis/db", () => db);
const auth = vi.hoisted(() => ({ requireAccountOwner: vi.fn() }));
vi.mock("@/lib/auth", () => auth);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { addNeverLogAction, removeNeverLogAction } from "./never-log-actions";

const ID = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  order.length = 0;
  for (const f of [...Object.values(db), ...Object.values(auth)]) f.mockReset();
  db.serviceDb.mockReturnValue({ svc: true });
  auth.requireAccountOwner.mockImplementation(async () => { order.push("auth"); return { userId: "user_owner", isAgency: false }; });
  db.addNeverLog.mockImplementation(async (_d: unknown, _a: string, p: { pattern: string; kind: string }) => { order.push("add"); return { outcome: "added", entry: { id: ID, pattern: p.pattern, kind: p.kind, addedBy: "user_owner", createdAt: "x" } }; });
  db.removeNeverLog.mockImplementation(async () => { order.push("remove"); return { id: ID, pattern: "supplier.com", kind: "domain", addedBy: "u", createdAt: "x" }; });
});

describe("addNeverLogAction", () => {
  it("proves the caller is the account's Owner or the agency BEFORE any write, then adds the normalised entry on the service client (mutation: write before requireAccountOwner → order differs, FAILS)", async () => {
    expect(await addNeverLogAction("acc", " Billing+Q3@Supplier.com ")).toEqual({ ok: true, entry: { id: ID, pattern: "billing@supplier.com", kind: "address" } });
    expect(order).toEqual(["auth", "add"]);
    expect(auth.requireAccountOwner).toHaveBeenCalledWith("acc");
    expect(db.addNeverLog).toHaveBeenCalledWith({ svc: true }, "acc", { pattern: "billing@supplier.com", kind: "address" }, "user_owner");
  });

  it("an invalid entry writes nothing; a duplicate and a full list answer their own error (mutation: map duplicate to failed → FAILS)", async () => {
    expect(await addNeverLogAction("acc", "not a domain")).toEqual({ ok: false, error: "invalid" });
    expect(await addNeverLogAction("acc", 42 as unknown as string)).toEqual({ ok: false, error: "invalid" });
    expect(db.addNeverLog).not.toHaveBeenCalled();
    db.addNeverLog.mockResolvedValueOnce({ outcome: "duplicate" });
    expect(await addNeverLogAction("acc", "supplier.com")).toEqual({ ok: false, error: "duplicate" });
    db.addNeverLog.mockResolvedValueOnce({ outcome: "full" });
    expect(await addNeverLogAction("acc", "supplier.com")).toEqual({ ok: false, error: "full" });
  });

  it("a database failure answers failed and logs no pattern (mutation: log the input → the line carries it, FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.addNeverLog.mockRejectedValueOnce(Object.assign(new Error("boom supplier.com"), { code: "XX000" }));
    expect(await addNeverLogAction("acc", "supplier.com")).toEqual({ ok: false, error: "failed" });
    expect(err.mock.calls.flat().join(" ")).not.toContain("supplier.com");
    err.mockRestore();
  });

  it("a refused caller never reaches the database (requireAccountOwner redirects by throwing; mutation: catch around the guard → FAILS)", async () => {
    auth.requireAccountOwner.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(addNeverLogAction("acc", "supplier.com")).rejects.toThrow("NEXT_REDIRECT");
    expect(db.addNeverLog).not.toHaveBeenCalled();
  });
});

describe("removeNeverLogAction", () => {
  it("removes by id WITHIN the proved account, after the guard (mutation: pass another account id → FAILS)", async () => {
    expect(await removeNeverLogAction("acc", ID)).toEqual({ ok: true, removed: { id: ID, pattern: "supplier.com", kind: "domain" } });
    expect(order).toEqual(["auth", "remove"]);
    expect(db.removeNeverLog).toHaveBeenCalledWith({ svc: true }, "acc", ID, "user_owner");
  });

  it("a non-uuid id writes nothing; an already-gone entry answers removed null (mutation: skip the uuid check → the DB is asked, FAILS)", async () => {
    expect(await removeNeverLogAction("acc", "'; drop")).toEqual({ ok: false, error: "failed" });
    expect(db.removeNeverLog).not.toHaveBeenCalled();
    db.removeNeverLog.mockResolvedValueOnce(null);
    expect(await removeNeverLogAction("acc", ID)).toEqual({ ok: true, removed: null });
  });
});
