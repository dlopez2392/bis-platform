import { describe, it, expect, vi, beforeEach } from "vitest";

/** Saving the account's required documents (spec 5.2; D6: the agency edits it now, the action admits an Owner). */
type Access = { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean };
const calls: unknown[][] = [];
const requireAccountAccess = vi.fn<(id: string) => Promise<Access>>();
vi.mock("@/lib/auth", () => ({ requireAccountAccess: (id: string) => requireAccountAccess(id) }));
const SVC = { tag: "service" };
const setRequiredDocumentCategories = vi.fn(async (_db: unknown, _acc: string, list: unknown) => list);
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return {
    ...real,
    serviceDb: () => { calls.push(["serviceDb"]); return SVC; },
    setRequiredDocumentCategories: (...a: [unknown, string, unknown]) => { calls.push(["set", ...a]); return setRequiredDocumentCategories(...a); },
  };
});
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
const { setRequiredDocumentCategoriesAction } = await import("./document-requirements-actions");
const { m } = await import("@/lib/messages");

const ACC = "44444444-4444-4444-8444-444444444444";
const OWNER: Access = { userId: "user_owner", isAgency: false, role: "owner", canManage: true };
const AGENCY: Access = { userId: "user_agency", isAgency: true, role: null, canManage: true };
const STAFF: Access = { userId: "user_staff", isAgency: false, role: "staff", canManage: false };
const form = (...cats: string[]) => { const f = new FormData(); for (const c of cats) f.append("category", c); return f; };

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireAccountAccess.mockResolvedValue(OWNER);
});

describe("setRequiredDocumentCategoriesAction", () => {
  it("an Owner's or the agency's ticks are cleaned to the vault's order before the write (I3; mutation: pass the raw list -> FAILS)", async () => {
    for (const who of [OWNER, AGENCY]) {
      calls.length = 0;
      requireAccountAccess.mockResolvedValue(who);
      expect(await setRequiredDocumentCategoriesAction(ACC, form("insurance", "id", "insurance"))).toEqual({ ok: true, list: ["id", "insurance"] });
      expect(calls).toEqual([["serviceDb"], ["set", SVC, ACC, ["id", "insurance"]]]);
      expect(revalidatePath).toHaveBeenLastCalledWith(`/dashboard/accounts/${ACC}/settings`);
      expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/accounts/${ACC}/documents`);
    }
  });
  it("Staff may not change it, and nothing is written (mutation: drop the role check -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    expect(await setRequiredDocumentCategoriesAction(ACC, form("id"))).toEqual({ ok: false, error: m["settings.requiredDocuments.role"] });
    expect(m["settings.requiredDocuments.role"]).toBe("Only an Owner can change this list.");
    expect(calls).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("Other, or anything not requirable, refuses the whole save before any write (mutation: skip the action's clean -> FAILS by the log)", async () => {
    expect(await setRequiredDocumentCategoriesAction(ACC, form("id", "other"))).toEqual({ ok: false, error: m["settings.requiredDocuments.failed"] });
    expect(m["settings.requiredDocuments.failed"]).toBe("Couldn't save the list. Try again.");
    expect(calls).toEqual([]);
  });
  it("no category at all turns the list off", async () => {
    expect(await setRequiredDocumentCategoriesAction(ACC, form())).toEqual({ ok: true, list: [] });
    expect(calls).toEqual([["serviceDb"], ["set", SVC, ACC, []]]);
  });
  it("a failed write is the display failure, and the page is not revalidated", async () => {
    setRequiredDocumentCategories.mockRejectedValueOnce(new Error("down"));
    expect(await setRequiredDocumentCategoriesAction(ACC, form("id"))).toEqual({ ok: false, error: m["settings.requiredDocuments.failed"] });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
