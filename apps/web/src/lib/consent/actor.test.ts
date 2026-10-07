import { describe, it, expect, vi } from "vitest";

const getUser = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => ({ users: { getUser } }) }));
import { actorName } from "./actor";

describe("actorName — 'confirmed by Ana' (plan G14)", () => {
  it("is the first name, else the full name, else null; Clerk unreachable is null, never a throw (mutation: rethrow → FAILS)", async () => {
    getUser.mockResolvedValueOnce({ firstName: " Ana ", fullName: "Ana Ruiz" });
    expect(await actorName("user_1")).toBe("Ana");
    getUser.mockResolvedValueOnce({ firstName: null, fullName: "Ana Ruiz" });
    expect(await actorName("user_1")).toBe("Ana Ruiz");
    getUser.mockResolvedValueOnce({ firstName: null, fullName: null });
    expect(await actorName("user_1")).toBeNull();
    vi.spyOn(console, "error").mockImplementation(() => {});
    getUser.mockRejectedValueOnce(new Error("clerk down"));
    expect(await actorName("user_1")).toBeNull();
  });
});
