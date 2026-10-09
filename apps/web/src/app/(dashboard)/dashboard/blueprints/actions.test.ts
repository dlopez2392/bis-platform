import { describe, it, expect, vi, beforeEach } from "vitest";

// D-086: the Add company dialog promised a blueprint could be applied later,
// and no screen could. applyBlueprintAction is the server half of the screen
// that now can (the company's Settings, ApplyBlueprintDialog).

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const authMocks = vi.hoisted(() => ({
  requireAgency: vi.fn(async () => ({ userId: "user_1" })),
  requireAgencyOnlyAccountAccess: vi.fn(async () => ({ userId: "user_1" })),
}));
vi.mock("@/lib/auth", () => authMocks);
const service = vi.hoisted(() => ({ tag: "serviceDb" }));
const dbMocks = vi.hoisted(() => ({
  applyBlueprint: vi.fn(),
  captureBlueprint: vi.fn(),
}));
vi.mock("@bis/db", () => ({ serviceDb: () => service, ...dbMocks }));

import { m } from "@/lib/messages";
import { applyBlueprintAction } from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  authMocks.requireAgencyOnlyAccountAccess.mockReset().mockResolvedValue({ userId: "user_1" });
  dbMocks.applyBlueprint.mockReset().mockResolvedValue({
    created: ["tag:a", "tag:b", "form:c"], skipped: ["pipeline:sales"], failed: [],
  });
});

describe("applyBlueprintAction (D-086)", () => {
  it("applies the chosen blueprint to THIS account as this user, and says how many items were new and how many already there (mutation: report skipped as added → FAILS)", async () => {
    expect(await applyBlueprintAction("acct_1", fd({ blueprintId: "bp_1" })))
      .toEqual({ ok: true, added: 3, already: 1 });
    expect(authMocks.requireAgencyOnlyAccountAccess).toHaveBeenCalledWith("acct_1");
    expect(dbMocks.applyBlueprint).toHaveBeenCalledWith(service, "acct_1", "bp_1", "user_1");
  });

  it("is agency-only: the gate runs before anything is applied (mutation: drop the gate → FAILS)", async () => {
    authMocks.requireAgencyOnlyAccountAccess.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(applyBlueprintAction("acct_1", fd({ blueprintId: "bp_1" }))).rejects.toThrow();
    expect(dbMocks.applyBlueprint).not.toHaveBeenCalled();
  });

  it("refuses with no blueprint chosen, applying nothing", async () => {
    expect(await applyBlueprintAction("acct_1", fd({ blueprintId: "  " })))
      .toEqual({ ok: false, error: m["blueprints.apply.pick"] });
    expect(dbMocks.applyBlueprint).not.toHaveBeenCalled();
  });

  it("a partial apply is reported as one, never as success (mutation: ignore report.failed → FAILS)", async () => {
    dbMocks.applyBlueprint.mockResolvedValue({ created: ["tag:a"], skipped: [], failed: [{ key: "form:c", error: "x" }] });
    expect(await applyBlueprintAction("acct_1", fd({ blueprintId: "bp_1" })))
      .toEqual({ ok: false, error: m["blueprints.apply.partial"] });
  });

  it("a thrown apply comes back as a plain refusal, not a crash", async () => {
    dbMocks.applyBlueprint.mockRejectedValue(new Error("blueprint not found"));
    expect(await applyBlueprintAction("acct_1", fd({ blueprintId: "bp_1" })))
      .toEqual({ ok: false, error: m["blueprints.apply.failed"] });
  });
});
