import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAccountAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ requireAccountAccess }));
const textsContextFor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/consent/texts-context", () => ({ textsContextFor }));
const stopTexts = vi.hoisted(() => vi.fn());
vi.mock("@/lib/consent/staff-actions", () => ({
  stopTexts, undoStopTexts: vi.fn(), resumeTexts: vi.fn(), confirmStop: vi.fn(), notAStop: vi.fn(), undoHoldDecision: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

import { stopTextsAction } from "./texts-actions";

beforeEach(() => {
  requireAccountAccess.mockReset();
  textsContextFor.mockReset();
  stopTexts.mockReset();
  revalidatePath.mockReset();
});

describe("texts-actions — the access gate runs BEFORE anything reads the ledger (review fix round 1, item 2)", () => {
  it("never calls textsContextFor (or a staff action) when requireAccountAccess redirects — Next's redirect() THROWS, so a caller who reordered these would leak a read past a client the access check just rejected (mutation: call textsContextFor first → FAILS)", async () => {
    requireAccountAccess.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(stopTextsAction("a1", "c1", null)).rejects.toThrow("NEXT_REDIRECT");
    expect(textsContextFor).not.toHaveBeenCalled();
    expect(stopTexts).not.toHaveBeenCalled();
  });
});
