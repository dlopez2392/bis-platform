import { describe, it, expect } from "vitest";
import { workRowLabel } from "./row-label";
import { makeTr } from "@/lib/record/copy";
import { m } from "@/lib/messages";

const row = (source: "task" | "conversation" | "booking", title = "") =>
  ({ id: `${source}:1`, source, accountId: "a", contactId: "k", title, dueAt: null, occurredAt: "x" }) as never;
describe("workRowLabel: the To do page's primary words, shared with the owner line", () => {
  it.each([["task", "Call back Maria", "Call back Maria"], ["conversation", "", "Reply to Maria"], ["booking", "", m["work.booking"]]] as const)(
    "%s reads %j", (source, title, words) => {
      expect(workRowLabel(row(source, title), "Maria", makeTr("en"), "America/Chicago")).toBe(words);
    });
  it("Spanish reads the Spanish twins", () => {
    expect(workRowLabel(row("booking"), "Maria", makeTr("es"), "America/Chicago")).toBe(m["work.booking.es"]);
  });
  it("a failed transfer reads the number to call back, or the bare words without one (F-077, merged 2026-11-11)", () => {
    const ft = (callbackNumber: string | null) =>
      ({ id: "failed_transfer:1", source: "failed_transfer", accountId: "a", contactId: "k", title: "", dueAt: null, occurredAt: "x", callbackNumber }) as never;
    expect(workRowLabel(ft("(956) 555-0100"), "Maria", makeTr("en"), "America/Chicago")).toBe(makeTr("en").text("work.failedTransfer", { number: "(956) 555-0100" }));
    expect(workRowLabel(ft(null), "Maria", makeTr("en"), "America/Chicago")).toBe(m["work.failedTransfer.bare"]);
  });
});
