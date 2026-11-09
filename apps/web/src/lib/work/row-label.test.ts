import { describe, it, expect } from "vitest";
import { workRowLabel } from "./row-label";
import { makeTr } from "@/lib/record/copy";
import { m } from "@/lib/messages";

const row = (source: "task" | "conversation" | "booking", title = "") =>
  ({ id: `${source}:1`, source, accountId: "a", contactId: "k", title, dueAt: null, occurredAt: "x" }) as never;
describe("workRowLabel: the To do page's primary words, shared with the owner line", () => {
  it.each([["task", "Call back Maria", "Call back Maria"], ["conversation", "", "Reply to Maria"], ["booking", "", m["work.booking"]]] as const)(
    "%s reads %j", (source, title, words) => {
      expect(workRowLabel(row(source, title), "Maria", makeTr("en"))).toBe(words);
    });
  it("Spanish reads the Spanish twins", () => {
    expect(workRowLabel(row("booking"), "Maria", makeTr("es"))).toBe(m["work.booking.es"]);
  });
});
