import { describe, it, expect } from "vitest";
import {
  roomLeft, inviteDefaultLanguage, clerkInviteError, ownerCount, clerkRoleFor,
  isTeamUserId, isInvitationId, isClerkUserId, UNDO_WINDOW_MS, undoStillOpen,
} from "./team-view";

describe("roomLeft (the login cap, spec §8)", () => {
  it("is the cap minus members minus pending invitations (mutation: forget pending -> FAILS)", () => {
    expect(roomLeft({ maxAllowed: 5, members: 3, pending: 1 })).toBe(1);
  });
  it("never goes below 0 (mutation: drop the clamp -> FAILS)", () => {
    expect(roomLeft({ maxAllowed: 2, members: 2, pending: 3 })).toBe(0);
  });
  it("no cap known is null, not a number (mutation: treat null as 0 -> FAILS)", () => {
    expect(roomLeft({ maxAllowed: null, members: 9, pending: 9 })).toBeNull();
  });
});

describe("inviteDefaultLanguage", () => {
  it("is es only when the account says es", () => {
    expect(inviteDefaultLanguage("es")).toBe("es");
  });
  it("anything else, missing or unknown, is en (mutation: pass any string through -> FAILS)", () => {
    expect(inviteDefaultLanguage(undefined)).toBe("en");
    expect(inviteDefaultLanguage("fr")).toBe("en");
    expect(inviteDefaultLanguage(null)).toBe("en");
  });
});

describe("clerkInviteError", () => {
  it("maps each expected Clerk code (mutation: swap any two -> FAILS)", () => {
    expect(clerkInviteError("duplicate_record")).toBe("already_invited");
    expect(clerkInviteError("already_a_member_in_organization")).toBe("already_member");
    expect(clerkInviteError("organization_membership_quota_exceeded")).toBe("full");
  });
  it("an unknown or missing code is failed, never a guess", () => {
    expect(clerkInviteError("something_new")).toBe("failed");
    expect(clerkInviteError(undefined)).toBe("failed");
  });
});

describe("ownerCount", () => {
  it("counts owners only (mutation: count everyone -> FAILS)", () => {
    expect(ownerCount([{ role: "owner" }, { role: "staff" }, { role: "owner" }])).toBe(2);
    expect(ownerCount([])).toBe(0);
  });
});

describe("clerkRoleFor (the Clerk role follows the BIS role)", () => {
  it("owner is org:admin and staff is org:member (mutation: always org:member -> FAILS)", () => {
    expect(clerkRoleFor("owner")).toBe("org:admin");
    expect(clerkRoleFor("staff")).toBe("org:member");
  });
});

describe("id shapes checked before use", () => {
  it("a BIS user id is a uuid", () => {
    expect(isTeamUserId("2f1c9a1e-6b1d-4c1a-9f7e-1a2b3c4d5e6f")).toBe(true);
    expect(isTeamUserId("user_2abc")).toBe(false);
    expect(isTeamUserId("2f1c9a1e-6b1d-4c1a-9f7e-1a2b3c4d5e6f; drop")).toBe(false);
  });
  it("an invitation id is orginv_ plus letters and digits (verified on the dev instance, 2026-10-10)", () => {
    expect(isInvitationId("orginv_2abcXYZ123")).toBe(true);
    expect(isInvitationId("orginv_")).toBe(false);
    expect(isInvitationId("inv_2abc")).toBe(false);
    expect(isInvitationId("orginv_2abc/../x")).toBe(false);
  });
  it("a Clerk user id is user_ plus letters and digits", () => {
    expect(isClerkUserId("user_2abcXYZ")).toBe(true);
    expect(isClerkUserId("org_2abc")).toBe(false);
    expect(isClerkUserId("user_2abc?x=1")).toBe(false);
  });
});

describe("the undo window for a removal", () => {
  it("is two minutes (mutation: any other value -> FAILS)", () => {
    expect(UNDO_WINDOW_MS).toBe(2 * 60 * 1000);
  });
  it("is open up to and including two minutes after the removal (mutation: < instead of <= -> FAILS)", () => {
    const at = Date.parse("2026-10-10T12:00:00.000Z");
    expect(undoStillOpen("2026-10-10T12:00:00.000Z", at + 1000)).toBe(true);
    expect(undoStillOpen("2026-10-10T12:00:00.000Z", at + UNDO_WINDOW_MS)).toBe(true);
  });
  it("is closed past two minutes, and for a timestamp that does not parse (mutation: drop the window -> FAILS)", () => {
    const at = Date.parse("2026-10-10T12:00:00.000Z");
    expect(undoStillOpen("2026-10-10T12:00:00.000Z", at + UNDO_WINDOW_MS + 1)).toBe(false);
    expect(undoStillOpen("not a date", at)).toBe(false);
  });
});
