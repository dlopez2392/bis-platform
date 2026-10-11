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
    expect(readPersonId).toHaveBeenCalledWith(DB, "u1");
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

  it("the agency asking for Mine (no users row in a client's company, A5) reads as All, with no Mine link", async () => {
    readPersonId.mockResolvedValueOnce(null);
    const v = await loadAssignView(DB, "a1", { userId: "u1", isAgency: true, role: null }, "mine", { members: false });
    expect(v).toMatchObject({ who: "all", personId: null, assignee: undefined, canAssign: true, showMine: false, members: [] });
    expect(listAccountTeam).not.toHaveBeenCalled();
  });

  it("the agency can still ask for Unassigned", async () => {
    readPersonId.mockResolvedValueOnce(null);
    const v = await loadAssignView(DB, "a1", { userId: "u1", isAgency: true, role: null }, "unassigned", { members: false });
    expect(v).toMatchObject({ who: "unassigned", assignee: { who: "unassigned" } });
  });
});
