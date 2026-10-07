import { describe, it, expect, vi } from "vitest";

vi.mock("@clerk/testing/playwright", () => ({ clerk: { signIn: vi.fn() } }));

import { agencyEmail, createAgencyUser, type ClerkBackend } from "./clerk-identities";
import { FIXTURE_EMAIL_RE, fixtureStamp } from "./stale";

/**
 * The throwaway agency user is shared by the e2e setup and the demo capture.
 * Two properties carry everything: the app_role claim (without it every
 * agency page signs in as a client) and an email the e2e sweep recognises
 * (without it a user leaked by a killed run is never deleted).
 */
describe("createAgencyUser", () => {
  it("creates the user with app_role agency_admin and the name it is given", async () => {
    const calls: Record<string, unknown>[] = [];
    const createUser = async (params: Record<string, unknown>) => { calls.push(params); return { id: "user_UNIT" }; };
    const clerk_ = { users: { createUser } } as unknown as ClerkBackend;

    const made = await createAgencyUser(clerk_, { firstName: "BIS", lastName: "Team" });

    expect(made.userId).toBe("user_UNIT");
    expect(calls).toHaveLength(1);
    const params = calls[0]!;
    expect(params.publicMetadata).toEqual({ app_role: "agency_admin" });
    expect(params.firstName).toBe("BIS");
    expect(params.lastName).toBe("Team");
    expect(params.emailAddress).toEqual([made.email]);
  });
});

describe("agencyEmail", () => {
  // Mutation: rename the prefix (e.g. `e2e-capture-`) -> FAILS, because the
  // sweep would no longer recognise a leaked capture user.
  it("is a shape the e2e sweep recognises, stamp and all", () => {
    const stamp = 1791400000000;
    expect(fixtureStamp(agencyEmail(stamp), FIXTURE_EMAIL_RE)).toBe(stamp);
  });
});
