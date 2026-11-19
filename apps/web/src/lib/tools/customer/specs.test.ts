// apps/web/src/lib/tools/customer/specs.test.ts
// F-023 PR 2 (plan §3.1, §3.2): the customer catalogue. Ten tools, each for a customer, each named ONCE; the three
// contracts that change with the session are variants of their tool, never a second entry. What each session is sent
// is pinned byte for byte by shapes.test.ts; this file pins the catalogue's own structure.
import { describe, it, expect } from "vitest";
import { CUSTOMER_TOOL_SPECS, CUSTOMER_TOOL_NAMES, selectVariant, type CustomerToolName } from "./specs";
import type { ToolName } from "@/lib/voice/tools/registry";

describe("the customer catalogue", () => {
  it("holds the phone's ten tools, in the order a phone session lists them, each for customers only", () => {
    expect(CUSTOMER_TOOL_NAMES).toEqual([
      "check_availability", "book_appointment", "reschedule_appointment", "cancel_appointment", "find_my_booking",
      "confirm_identity", "capture_lead", "take_message", "log_transcript", "transfer_to_human",
    ]);
    expect(new Set(CUSTOMER_TOOL_SPECS.map((s) => s.audience))).toEqual(new Set(["customer"]));
  });

  it("names each tool once: a variant is never a second entry", () => {
    expect(new Set(CUSTOMER_TOOL_NAMES).size).toBe(CUSTOMER_TOOL_NAMES.length);
  });

  it("carries exactly three variants, each the same tool for the same audience", () => {
    const variants = CUSTOMER_TOOL_SPECS.flatMap((s) => ("variants" in s
      ? Object.entries(s.variants).map(([key, v]) => [s.name, key, v.name, v.audience]) : []));
    expect(variants).toEqual([
      ["check_availability", "manage", "check_availability", "customer"],
      ["book_appointment", "video", "book_appointment", "customer"],
      ["capture_lead", "web", "capture_lead", "customer"],
    ]);
  });

  it("selectVariant picks the variant a session fact names, and the tool itself for any other fact", () => {
    const book = CUSTOMER_TOOL_SPECS[1];
    expect(selectVariant(book, ["full", "video"])).toBe(book.variants.video);
    expect(selectVariant(book, ["full", "in_person"])).toBe(book);
    expect(selectVariant(book, ["manage", "phone"])).toBe(book);
    const take = CUSTOMER_TOOL_SPECS[7];
    expect(selectVariant(take, ["manage", "video", "web"])).toBe(take);
  });

  // TYPE checks: `pnpm --filter web typecheck` fails if a name type widens to string (an `as const` dropped).
  it("keeps the name types narrow, and ToolName is the catalogue's names", () => {
    // @ts-expect-error calls_and_messages is a staff tool, not a customer tool
    const customer: CustomerToolName = "calls_and_messages";
    // @ts-expect-error calls_and_messages is not a phone tool
    const phone: ToolName = "calls_and_messages";
    const same: CustomerToolName[] = ["take_message"] satisfies ToolName[];
    expect([customer, phone, ...same]).toEqual(["calls_and_messages", "calls_and_messages", "take_message"]);
  });
});
