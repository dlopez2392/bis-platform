import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const dbMocks = vi.hoisted(() => ({
  setBranding: vi.fn(),
  getBranding: vi.fn(),
  uploadBrandLogo: vi.fn(),
  removeBrandLogo: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}),
}));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: true }),
}));
// setBrandingAction writes through the RLS-enforced client, not serviceDb() —
// see the action's own doc comment. A real client is unnecessary here since
// dbForRequest's result only ever flows straight into the (mocked)
// setBranding call.
const dbForRequestInstance = { tag: "dbForRequest" };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => dbForRequestInstance }));

import { m } from "@/lib/messages";
import { setBrandingAction } from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  dbMocks.setBranding.mockReset().mockResolvedValue(undefined);
  dbMocks.getBranding.mockReset();
  dbMocks.uploadBrandLogo.mockReset();
  dbMocks.removeBrandLogo.mockReset();
});

describe("setBrandingAction — brand name is required", () => {
  it("refuses a blank brandName without writing", async () => {
    expect(await setBrandingAction("acct_1", fd({ brandName: "" })))
      .toEqual({ ok: false, error: m["branding.nameRequired"] });
    expect(dbMocks.setBranding).not.toHaveBeenCalled();
  });

  it("refuses a whitespace-only brandName without writing", async () => {
    // Mutation: delete the `if (!brandName) return …` guard in the action —
    // a whitespace name then saves as "" instead of being refused. (Restoring
    // the old `|| null` alone is NOT a mutation that bites: null is falsy, so
    // the guard still refuses it.)
    expect(await setBrandingAction("acct_1", fd({ brandName: "   " })))
      .toEqual({ ok: false, error: m["branding.nameRequired"] });
    expect(dbMocks.setBranding).not.toHaveBeenCalled();
  });

  it("saves a normal, trimmed name", async () => {
    expect(await setBrandingAction("acct_1", fd({ brandName: "  Acme Dental  " })))
      .toEqual({ ok: true });
    expect(dbMocks.setBranding).toHaveBeenCalledWith(
      dbForRequestInstance, "acct_1",
      {
        brandName: "Acme Dental", brandColor: null, brandNeutral: null,
        brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
      },
      "user_1",
    );
  });
});
