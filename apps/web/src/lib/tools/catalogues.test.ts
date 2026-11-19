// apps/web/src/lib/tools/catalogues.test.ts
// F-023 plan §3.1: the customer and staff catalogues share no name, so a tool name can never mean a customer tool on
// one session and a staff tool on another. Until the phone tools move onto the belt (PR 2), the customer side is
// every name lib/voice/tools/schemas.ts can put on a phone session, in every mode × meeting type × handoff.
import { describe, it, expect } from "vitest";
import { STAFF_TOOL_SPECS, STAFF_TOOL_NAMES, type StaffToolName } from "./staff/specs";
import type { OwnerToolName } from "@/lib/owner-line/tools/schemas";
import { toolSchemas } from "@/lib/voice/tools/schemas";
import { CUSTOMER_TOOL_SPECS, CUSTOMER_TOOL_NAMES } from "./customer/specs";

const phoneNames = new Set<string>();
for (const mode of ["full", "manage", "none"] as const) {
  for (const meeting of ["in_person", "phone", "video"] as const) {
    for (const handoff of [true, false]) {
      for (const t of toolSchemas(mode, meeting, handoff)) phoneNames.add(t.name);
    }
  }
}

describe("the staff catalogue", () => {
  it("holds the owner line's three reads, each for staff only", () => {
    expect(STAFF_TOOL_NAMES).toEqual(["calls_and_messages", "appointments", "needs_attention"]);
    expect(STAFF_TOOL_SPECS.map((s) => s.audience)).toEqual(["staff", "staff", "staff"]);
  });

  // A TYPE check: `pnpm --filter web typecheck` fails if either name type widens to string (the `as const` dropped),
  // because the directives then have no error to expect.
  it("keeps its name types narrow: a phone tool's name is not a staff or an owner tool name", () => {
    // @ts-expect-error take_message is not a staff tool
    const staff: StaffToolName = "take_message";
    // @ts-expect-error take_message is not an owner tool
    const owner: OwnerToolName = "take_message";
    expect([staff, owner]).toEqual(["take_message", "take_message"]);
  });

  it("shares no name with any tool a phone session can be given (mutation: add a staff spec named take_message -> FAILS)", () => {
    // The phone list really was read: the receptionist's own tools are in it.
    expect(phoneNames).toContain("take_message");
    expect(phoneNames).toContain("transfer_to_human");
    expect(STAFF_TOOL_NAMES.filter((n) => phoneNames.has(n))).toEqual([]);
  });

  it("shares no name with the customer catalogue, which is every name a phone session can be given (PR 2)", () => {
    expect(new Set(CUSTOMER_TOOL_NAMES)).toEqual(phoneNames);
    expect(CUSTOMER_TOOL_SPECS.every((s) => s.audience === "customer")).toBe(true);
    expect(STAFF_TOOL_NAMES.filter((n) => (CUSTOMER_TOOL_NAMES as readonly string[]).includes(n))).toEqual([]);
  });
});
