import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextUpBody } from "./next-up-card";

const props = { emptyText: "Nothing coming up.", addTodoLabel: "Add a To-do" };

describe("NextUpBody (spec §9.3)", () => {
  it("an overdue To-do is a dot AND a word (rule 3; mutation: drop the dot -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(NextUpBody, { ...props, view: { undated: null, rows: [
      { kind: "task", id: "t", title: "Call back", detail: "Overdue · was due Oct 1, 2026", overdue: true },
      { kind: "booking", id: "b", label: "Appointment · Fri, Oct 16 · 10:00 AM" },
    ] } }));
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*bg-\[var\(--warn\)\][^"]*"><\/span><span[^>]*>Overdue · was due Oct 1, 2026/);
    expect(html).toContain('data-next-up-row="booking"');
    expect(html).toContain("Appointment · Fri, Oct 16 · 10:00 AM");
  });
  it("empty: one sentence of what shows here and the action that causes it, plus the undated count", () => {
    const html = renderToStaticMarkup(createElement(NextUpBody, { ...props, view: { rows: [], undated: "2 more To-dos have no date." } }));
    expect(html).toContain("Nothing coming up.");
    expect(html).toContain(">Add a To-do<");
    expect(html).toContain("2 more To-dos have no date.");
  });
});
