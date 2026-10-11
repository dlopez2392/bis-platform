import { describe, it, expect } from "vitest";
import { isRefusal } from "@/lib/assign/action-guards";

// Fix round 1 (m1): a refusal is SQLSTATE 42501 (RLS or 0068's trigger),
// carried on the error by @bis/db's AssignmentDbError. Never the wording.
describe("isRefusal", () => {
  it("code 42501 is a refusal, whatever the message says (the trigger's own words included)", () => {
    expect(isRefusal(Object.assign(new Error("tasks: a technician cannot change a task's assignee"), { code: "42501" }))).toBe(true);
    expect(isRefusal(Object.assign(new Error("new row violates row-level security policy"), { code: "42501" }))).toBe(true);
  });
  it("a message that merely mentions row-level security or 42501, with no code, is not (mutation: match the message -> FAILS)", () => {
    expect(isRefusal(new Error("assignContacts failed: new row violates row-level security policy"))).toBe(false);
    expect(isRefusal(new Error("contact 42501 not found"))).toBe(false);
  });
  it("another code, a plain Error and a non-object are not", () => {
    expect(isRefusal(Object.assign(new Error("dup"), { code: "23505" }))).toBe(false);
    expect(isRefusal(new Error("boom"))).toBe(false);
    expect(isRefusal("42501")).toBe(false);
    expect(isRefusal(null)).toBe(false);
  });
});
