import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { UsageCard } from "./usage-card";

const render = (props: Parameters<typeof UsageCard>[0]) => renderedText(renderToStaticMarkup(createElement(UsageCard, props)));

const usage = { textsSent: 12, emailsSent: 3, conversations: 7, callsHandled: 41, held: 2, skipped: 8, topHeldReason: "Held until 8:00 AM — quiet hours", topSkippedReason: "Screened as a robocall" };

describe("UsageCard", () => {
  it("four numbers, the month label, and the cap beside each (rule 1: never a count alone)", () => {
    const text = render({ state: { ok: true, usage }, monthLabel: "September 2026", callCap: 50 });
    expect(text).toContain("September 2026");
    for (const n of ["12", "3", "7", "41"]) expect(text).toContain(n);
    expect(text).toContain("Up to 25 a day per automation");
    expect(text).toContain("Up to 300 a day");
    expect(text).toContain("Up to 50 a day");
    expect(text).toContain("2 waiting · most often: Held until 8:00 AM — quiet hours");
    expect(text).toContain("8 skipped · most often: Screened as a robocall");
  });
  it("zero is a number, not a blank; no reason line when there is no reason", () => {
    const text = render({ state: { ok: true, usage: { ...usage, held: 0, skipped: 0, topHeldReason: null, topSkippedReason: null } }, monthLabel: "September 2026", callCap: 50 });
    expect(text).toContain("0 waiting");
    expect(text).toContain("0 skipped");
    expect(text).not.toContain("most often");
  });
  it("the error state names the fix and still shows the month", () => {
    const text = render({ state: { ok: false }, monthLabel: "September 2026", callCap: 50 });
    expect(text).toContain("Couldn't load this month's numbers");
    expect(text).toContain("September 2026");
  });
});
