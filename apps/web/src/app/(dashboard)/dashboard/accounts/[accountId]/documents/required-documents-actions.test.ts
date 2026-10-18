import { describe, it, expect, vi, beforeEach } from "vitest";

const access = vi.hoisted(() => ({ value: { userId: "u1", isAgency: false, role: "owner" as string | null, canManage: true } }));
const db = vi.hoisted(() => ({ restore: vi.fn(), serviceDb: vi.fn(() => ({ tag: "service" })) }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ requireAccountAccess: vi.fn(async () => access.value) }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@bis/db", async () => {
  const rules = await vi.importActual<typeof import("@bis/db/document-rules")>("@bis/db/document-rules");
  return { serviceDb: db.serviceDb, restoreRequiredDocumentCategories: db.restore, cleanRequiredCategories: rules.cleanRequiredCategories };
});
import { undoRequiredDocumentsAction } from "./required-documents-actions";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  access.value = { userId: "u1", isAgency: false, role: "owner", canManage: true };
  db.restore.mockResolvedValue(true);
});

describe("undoRequiredDocumentsAction (spec 3.3; plan deviation 9)", () => {
  it("refuses a Staff member before any write (mutation: drop the canManage check -> restore is called -> FAILS)", async () => {
    access.value = { userId: "u2", isAgency: false, role: "staff", canManage: false };
    expect(await undoRequiredDocumentsAction("a1", ["id"], [])).toEqual({ ok: false, error: "documents.required.role" });
    expect(db.restore).not.toHaveBeenCalled();
  });

  it("refuses a list that is not requirable before any write (mutation: skip the clean -> FAILS)", async () => {
    expect(await undoRequiredDocumentsAction("a1", ["other"], [])).toEqual({ ok: false, error: "documents.required.failed" });
    expect(db.restore).not.toHaveBeenCalled();
  });

  it("restores on the service client with the cleaned lists in the vault's order and revalidates both pages (mutation: swap expected and previous -> FAILS)", async () => {
    expect(await undoRequiredDocumentsAction("a1", ["insurance", "id"], ["warranty"])).toEqual({ ok: true });
    expect(db.restore).toHaveBeenCalledWith({ tag: "service" }, "a1", ["id", "insurance"], ["warranty"]);
    expect(revalidatePath.mock.calls.map((c) => c[0]).sort()).toEqual(["/dashboard/accounts/a1/documents", "/dashboard/accounts/a1/settings"]);
  });

  it("answers changed when the stored list moved on, and failed when the write throws (mutation: answer ok on false -> FAILS)", async () => {
    db.restore.mockResolvedValueOnce(false);
    expect(await undoRequiredDocumentsAction("a1", ["id"], [])).toEqual({ ok: false, error: "documents.required.changed" });
    db.restore.mockRejectedValueOnce(new Error("boom"));
    expect(await undoRequiredDocumentsAction("a1", ["id"], [])).toEqual({ ok: false, error: "documents.required.failed" });
  });
});
