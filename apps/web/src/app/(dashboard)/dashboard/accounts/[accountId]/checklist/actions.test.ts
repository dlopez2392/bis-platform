import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAgencyOnlyAccountAccess: vi.fn(async () => ({ userId: "user_1" })) }));
vi.mock("@/lib/db", () => ({ dbForRequest: vi.fn() }));
// vi.mock factories are hoisted above every declaration in this file, so
// what they close over must be made by vi.hoisted (a class declared below
// would be in its temporal dead zone when the factory runs).
const { setA2p, MessagingProfileTakenError } = vi.hoisted(() => ({
  setA2p: vi.fn(),
  MessagingProfileTakenError: class MessagingProfileTakenError extends Error {},
}));
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return {
    ...real, serviceDb: () => ({}), setA2pRegistration: setA2p,
    MessagingProfileTakenError, addCustomChecklistItem: vi.fn(),
  };
});

import { setA2pRegistrationAction } from "./actions";
import { m } from "@/lib/messages";

const P = "740572b6-099c-44a1-89b9-6c92163bc68d";
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

beforeEach(() => { setA2p.mockReset().mockResolvedValue(undefined); });

describe("setA2pRegistrationAction — the messaging profile (plan Task 7)", () => {
  it("approved with brand and campaign but no profile is refused with its own line, and nothing is written (mutation: drop the profile check → the write runs, FAILS)", async () => {
    expect(await setA2pRegistrationAction("a1", form({ status: "approved", brandId: "B", campaignId: "C" })))
      .toEqual({ ok: false, error: m["a2p.approvedNeedsProfile"] });
    expect(setA2p).not.toHaveBeenCalled();
  });

  it("a profile id is trimmed and lowercased before it is written (mutation: write it as typed → FAILS)", async () => {
    expect(await setA2pRegistrationAction("a1", form({ status: "approved", brandId: "B", campaignId: "C", messagingProfileId: `  ${P.toUpperCase()} ` })))
      .toEqual({ ok: true });
    expect(setA2p.mock.calls[0]![2]).toEqual({ brandId: "B", campaignId: "C", status: "approved", messagingProfileId: P });
  });

  it("something that is not a profile id is refused before the write (mutation: skip isMessagingProfileId → FAILS)", async () => {
    expect(await setA2pRegistrationAction("a1", form({ status: "pending", messagingProfileId: "profile-1" })))
      .toEqual({ ok: false, error: m["a2p.profileMalformed"] });
    expect(setA2p).not.toHaveBeenCalled();
  });

  it("a profile another company already uses says so, never the generic failure (mutation: drop the instanceof branch → saveFailed, FAILS)", async () => {
    setA2p.mockRejectedValue(new MessagingProfileTakenError("taken"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await setA2pRegistrationAction("a1", form({ status: "pending", messagingProfileId: P })))
      .toEqual({ ok: false, error: m["a2p.profileTaken"] });
  });
});
