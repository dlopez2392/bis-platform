import { describe, it, expect, vi, beforeEach } from "vitest";

const readPersonId = vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => "p-me");
const listAccountTeam = vi.fn<(...a: unknown[]) => Promise<unknown[]>>(async () => [
  { userId: "p-me", clerkUserId: "c1", email: "me@x.test", name: "Ana", role: "owner", language: null },
  { userId: "p-t", clerkUserId: "c2", email: "tech@x.test", name: null, role: "technician", language: null },
]);
vi.mock("@bis/db", () => ({
  readPersonId: (...a: unknown[]) => readPersonId(...a),
  listAccountTeam: (...a: unknown[]) => listAccountTeam(...a),
}));

const { loadAssignView } = await import("@/lib/assign/view");
const DB = { tag: "request-db" } as never;

beforeEach(() => {
  readPersonId.mockClear();
  listAccountTeam.mockClear();
});

describe("loadAssignView: what a list page needs for Mine / Unassigned (spec §8-§9)", () => {
  it("Owner/Staff with who=mine: their own filter, may assign, sees Mine, and the team as options (name, else email)", async () => {
    const v = await loadAssignView(DB, "a1", { userId: "u1", isAgency: false, role: "staff" }, "mine", { members: true });
    expect(readPersonId).toHaveBeenCalledWith(DB, "a1", "u1");
    expect(listAccountTeam).toHaveBeenCalledWith(DB, "a1");
    expect(v).toEqual({
      who: "mine", personId: "p-me", assignee: { who: "mine", userId: "p-me" }, canAssign: true, showMine: true,
      members: [
        { userId: "p-me", label: "Ana", role: "owner" },
        { userId: "p-t", label: "tech@x.test", role: "technician" },
      ],
    });
  });

  it("a Technician: no filter, may not assign, no Mine link, and nothing is read (mutation: honour who for a Technician -> FAILS)", async () => {
    const v = await loadAssignView(DB, "a1", { userId: "u1", isAgency: false, role: "technician" }, "unassigned", { members: true });
    expect(v).toEqual({ who: "all", personId: null, assignee: undefined, canAssign: false, showMine: false, members: [] });
    expect(readPersonId).not.toHaveBeenCalled();
    expect(listAccountTeam).not.toHaveBeenCalled();
  });

  it("a client whose role could not be settled is treated as a Technician (fails closed; mutation: role !== technician -> FAILS)", async () => {
    const v = await loadAssignView(DB, "a1", { userId: "u1", isAgency: false, role: null }, "mine", { members: true });
    expect(v.canAssign).toBe(false);
    expect(v.assignee).toBeUndefined();
  });

  // Fix round 1 (C1): since 0067 the agency's staff DO have a users row (the
  // theme toggle), but never a membership in a client's company. The read is
  // account-scoped, so the database answers null: modelled here as a users
  // row that only an unscoped read would find.
  it("the agency WITH a users row asking for Mine reads as All, with no Mine link, because the person read is scoped to this account (mutation: read without the account -> FAILS)", async () => {
    readPersonId.mockImplementationOnce(async (...a: unknown[]) => (a.length === 3 && a[1] === "a1" ? null : "p-agency"));
    const v = await loadAssignView(DB, "a1", { userId: "u1", isAgency: true, role: null }, "mine", { members: false });
    expect(v).toMatchObject({ who: "all", personId: null, assignee: undefined, canAssign: true, showMine: false, members: [] });
    expect(listAccountTeam).not.toHaveBeenCalled();
  });

  it("the agency WITH a users row can still ask for Unassigned", async () => {
    readPersonId.mockImplementationOnce(async (...a: unknown[]) => (a.length === 3 && a[1] === "a1" ? null : "p-agency"));
    const v = await loadAssignView(DB, "a1", { userId: "u1", isAgency: true, role: null }, "unassigned", { members: false });
    expect(v).toMatchObject({ who: "unassigned", assignee: { who: "unassigned" } });
  });
});

// Task 7 fix round 1 (I1): a read-only viewer's "Assigned to" says "You" only
// for the customers that ARE theirs, so the screens that show that field ask
// for the viewer's own person, still with no filter and no team.
describe("loadAssignView: the viewer's own person for a read-only screen (opts.viewer)", () => {
  it("a Technician with viewer: their person is read (account-scoped), still no filter, no team, no Mine (mutation: skip the read -> FAILS)", async () => {
    readPersonId.mockResolvedValueOnce("p-t");
    const v = await loadAssignView(DB, "a1", { userId: "u1", isAgency: false, role: "technician" }, "mine", { members: true, viewer: true });
    expect(readPersonId).toHaveBeenCalledWith(DB, "a1", "u1");
    expect(v).toEqual({ who: "all", personId: "p-t", assignee: undefined, canAssign: false, showMine: false, members: [] });
    expect(listAccountTeam).not.toHaveBeenCalled();
  });

  it("without viewer a Technician's page still reads nothing (the list pages)", async () => {
    await loadAssignView(DB, "a1", { userId: "u1", isAgency: false, role: "technician" }, undefined, { members: true });
    expect(readPersonId).not.toHaveBeenCalled();
  });
});

// Final review N2: the viewer's own person only decides whether a read-only
// "Assigned to" says "You" or "Someone on the team". A failed read of it must
// not take the Contacts page down for a Technician: it is logged (redacted)
// and read as "not you".
describe("loadAssignView: a failed viewer read is soft for a read-only viewer", () => {
  it("a Technician whose own person cannot be read gets personId null and the page still loads; logged with the account, redacted (mutation: let it throw -> FAILS)", async () => {
    readPersonId.mockRejectedValueOnce(new Error("readPersonId failed: boom for tech@x.test"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const v = await loadAssignView(DB, "a1", { userId: "u1", isAgency: false, role: "technician" }, undefined, { members: true, viewer: true });
      expect(v).toEqual({ who: "all", personId: null, assignee: undefined, canAssign: false, showMine: false, members: [] });
      const line = spy.mock.calls.flat().join(" ");
      expect(line).toContain("a1");
      expect(line).toContain("readPersonId failed: boom for [email]");
      expect(line).not.toContain("tech@x.test");
    } finally {
      spy.mockRestore();
    }
  });
  it("an Owner's failed read still throws: their filter and their Mine depend on it, so the page's error state is right (mutation: soften every read -> FAILS)", async () => {
    readPersonId.mockRejectedValueOnce(new Error("readPersonId failed: boom"));
    await expect(loadAssignView(DB, "a1", { userId: "u1", isAgency: false, role: "owner" }, "mine", { members: true, viewer: true }))
      .rejects.toThrow("boom");
  });
});
