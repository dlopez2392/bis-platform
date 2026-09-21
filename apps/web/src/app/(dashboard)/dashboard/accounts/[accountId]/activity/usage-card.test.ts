import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { UsageCard } from "./usage-card";

const renderHtml = (props: Parameters<typeof UsageCard>[0]) => renderToStaticMarkup(createElement(UsageCard, props));
const render = (props: Parameters<typeof UsageCard>[0]) => renderedText(renderHtml(props));

// Each tile's own `data-usage="<key>"` block, isolated — a bare
// `text.toContain(n)` over the whole card lets one tile's number collide
// with digits INSIDE another tile's cap sentence ("3" inside "Up to 300 a
// day"), which would leave a wrong or missing count undetected. Neither
// `dt` nor `dd` nests a `<div>`, so the first `</div>` after the opening
// tag is always this tile's own close.
function tileText(html: string, key: string): string {
  const start = html.indexOf(`data-usage="${key}"`);
  if (start === -1) throw new Error(`no tile for "${key}" in rendered HTML`);
  const end = html.indexOf("</div>", start);
  return renderedText(html.slice(start, end));
}

const usage = { textsSent: 12, emailsSent: 3, conversations: 7, callsHandled: 41, held: 2, skipped: 8, topHeldReason: "Held until 8:00 AM — quiet hours", topSkippedReason: "Screened as a robocall" };

describe("UsageCard", () => {
  it("four numbers, the month label, and the cap beside each (rule 1: never a count alone)", () => {
    const html = renderHtml({ state: { ok: true, usage }, monthLabel: "September 2026", callCap: 50 });
    const text = renderedText(html);
    expect(text).toContain("September 2026");
    expect(tileText(html, "texts")).toContain("12");
    expect(tileText(html, "emails")).toContain("3");
    expect(tileText(html, "conversations")).toContain("7");
    expect(tileText(html, "calls")).toContain("41");
    expect(text).toContain("Most automations: up to 25 a day");
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
