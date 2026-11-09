// apps/web/src/lib/owner-line/finish.test.ts
// F-032 plan Task 12: the owner-line call's finish (spec §6). It closes its own row, records its minutes and its
// access-log entry, and reaches nothing that writes to a customer.
import { describe, it, expect, vi, beforeEach } from "vitest";
const d = vi.hoisted(() => ({ finish: vi.fn(), note: vi.fn(), usage: vi.fn() }));
vi.mock("@bis/db", () => ({ finishCallRow: d.finish, noteOwnerLineCall: d.note }));
vi.mock("@/lib/billing/usage", () => ({ recordUsageSafely: d.usage, voiceMinutes: (s: number) => Math.max(1, Math.ceil(s / 60)) }));
import { finishOwnerLineCall } from "./finish";
import { emptyCallState, withTranscript } from "@/lib/voice/call-state";

const S = { accountId: "a1", userId: "u1", role: "owner" as const, clerkUserId: "user_d", clerkOrgId: "org_a",
  firstName: "Dan", actorName: "Dan Lopez", locale: "en" as const, timezone: "America/Chicago" };
const T0 = new Date("2026-11-09T21:00:00Z");
const T1 = new Date("2026-11-09T21:02:05Z");
beforeEach(() => { vi.clearAllMocks(); d.finish.mockResolvedValue(undefined); d.note.mockResolvedValue(undefined); });

describe("finishOwnerLineCall (spec §6)", () => {
  it("closes the row with its transcript, records the minutes, and writes the access-log entry with the tools that ran", async () => {
    const state = withTranscript(emptyCallState(), { role: "caller", text: "what calls did I get today?", at: T0.toISOString() });
    await finishOwnerLineCall(state, { db: {} as never, session: S, ran: new Set(["calls_and_messages", "appointments"] as const) },
      { callRowId: "row1", startedAt: T0, endedAt: T1 });
    expect(d.finish).toHaveBeenCalledWith({}, "a1", "row1", expect.objectContaining({ durationSecs: 125, turnCount: 1, summary: "" }));
    expect(d.usage).toHaveBeenCalledWith({}, expect.objectContaining({ meter: "voice_minutes", quantity: 3, sourceRef: "call:row1" }), expect.any(String));
    expect(d.note).toHaveBeenCalledWith({}, { accountId: "a1", callId: "row1", actorClerkUserId: "user_d", actorName: "Dan Lopez",
      kinds: ["owner_line_calls_and_messages", "owner_line_appointments"] });
  });
  it("the outcome is the column default, abandoned: every counting reader leaves the row out by owner_line_user_id (Task 2)", async () => {
    await finishOwnerLineCall(emptyCallState(), { db: {} as never, session: S, ran: new Set() }, { callRowId: "row1", startedAt: T0, endedAt: T1 });
    expect(d.finish.mock.calls[0]![3]).toMatchObject({ outcome: "abandoned" });
  });
  it("no minutes when the person never spoke (M7a: minutes are for a call Sofía talked to)", async () => {
    await finishOwnerLineCall(emptyCallState(), { db: {} as never, session: S, ran: new Set() }, { callRowId: "row1", startedAt: T0, endedAt: T1 });
    expect(d.usage).not.toHaveBeenCalled();
  });
  it("each leg on its own: a failed row write still logs who heard what (mutation: one shared try -> FAILS)", async () => {
    d.finish.mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await finishOwnerLineCall(emptyCallState(), { db: {} as never, session: S, ran: new Set() }, { callRowId: "row1", startedAt: T0, endedAt: T1 });
    expect(d.note).toHaveBeenCalled();
  });
  it("never throws, and its failure lines name the error class and the account only, never the error's words", async () => {
    d.finish.mockRejectedValue(new Error("finishCallRow failed for +19565550142"));
    d.note.mockRejectedValue(new Error("noteOwnerLineCall failed: Dan Lopez"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(finishOwnerLineCall(emptyCallState(), { db: {} as never, session: S, ran: new Set() },
      { callRowId: "row1", startedAt: T0, endedAt: T1 })).resolves.toBeUndefined();
    const lines = err.mock.calls.flat().map(String).join("\n");
    expect(lines).toContain("[voice/owner-line] call row finish failed (Error), accountId a1");
    expect(lines).toContain("[voice/owner-line] access-log entry failed (Error), accountId a1");
    expect(lines).not.toContain("19565550142");
    expect(lines).not.toContain("Dan Lopez");
  });
  it("with no call row nothing is written: there is no row id to log against", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await finishOwnerLineCall(emptyCallState(), { db: {} as never, session: S, ran: new Set(["appointments"] as const) },
      { callRowId: null, startedAt: T0, endedAt: T1 });
    expect(d.finish).not.toHaveBeenCalled();
    expect(d.note).not.toHaveBeenCalled();
  });
  it("can reach nothing that writes to a customer, an automation log or an event: its imports are exactly these (mutation: import ensureCallbackTask from @bis/db -> FAILS)", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("./finish.ts", import.meta.url), "utf8");
    // Import lines only, never prose: a guard that a doc comment can satisfy or trip is no guard (memory bis-vacuous-test-shapes).
    const lines = [...src.matchAll(/^import [^;]+;$/gm)].map((x) => x[0]).sort();
    expect(lines).toEqual([
      'import type { CallState } from "@/lib/voice/call-state";',
      'import type { OwnerLineSession } from "./session";',
      'import { LOG_KIND_OF, type OwnerToolName } from "./tools/schemas";',
      'import { detectCallerLanguage } from "@/lib/voice/language";',
      'import { finishCallRow, noteOwnerLineCall, type SupabaseClient } from "@bis/db";',
      'import { recordUsageSafely, voiceMinutes } from "@/lib/billing/usage";',
    ].sort());
  });
});
