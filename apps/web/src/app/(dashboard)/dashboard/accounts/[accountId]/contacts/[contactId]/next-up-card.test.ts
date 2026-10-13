import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ADD_TODO_FIELD_ID } from "./constants";

// The empty state's action is captured: what it is pointed at is the behaviour (review round 1, I1).
const focusProps = vi.hoisted(() => [] as { targetId: string; label: string }[]);
vi.mock("./focus-field-button", async () => {
  const { createElement: h } = await import("react");
  return { FocusFieldButton: (p: { targetId: string; label: string }) => { focusProps.push(p); return h("button", { type: "button" }, p.label); } };
});
const { NextUpBody } = await import("./next-up-card");

const props = { emptyText: "Nothing coming up.", addTodoLabel: "Add a To-do" };

describe("NextUpBody (spec §9.3)", () => {
  it("an overdue To-do is a dot AND a word (rule 3; mutation: drop the dot -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(NextUpBody, { ...props, view: { undated: null, rows: [
      { kind: "task", id: "t", title: "Call back", detail: "Overdue · was due Oct 1, 2026", overdue: true, who: null },
      { kind: "booking", id: "b", label: "Appointment · Fri, Oct 16 · 10:00 AM", who: null },
    ] } }));
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*bg-\[var\(--warn\)\][^"]*"><\/span><span[^>]*>Overdue · was due Oct 1, 2026/);
    expect(html).toContain('data-next-up-row="booking"');
    expect(html).toContain("Appointment · Fri, Oct 16 · 10:00 AM");
  });
  it("a To-do title is typed text and carries lang=\"\", keeping its title attribute (mutation: drop the span wrapper -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(NextUpBody, { ...props, view: { undated: null, rows: [
      { kind: "task", id: "t", title: "Llamar a Ana", detail: "Due Oct 20", overdue: false, who: null },
    ] } }));
    expect(html).toContain('title="Llamar a Ana"><span lang="">Llamar a Ana</span>');
  });
  it("empty: one sentence of what shows here and the action that causes it, plus the undated count", () => {
    const html = renderToStaticMarkup(createElement(NextUpBody, { ...props, view: { rows: [], undated: "2 To-dos have no date." } }));
    expect(html).toContain("Nothing coming up.");
    expect(html).toContain(">Add a To-do<");
    expect(html).toContain("2 To-dos have no date.");
  });
  it("the empty state's Add a To-do points at the timeline's To-do field (review round 1, I1; mutation: targetId=\"nowhere\" -> FAILS)", () => {
    focusProps.length = 0;
    renderToStaticMarkup(createElement(NextUpBody, { ...props, view: { rows: [], undated: null } }));
    expect(focusProps).toEqual([{ targetId: ADD_TODO_FIELD_ID, label: "Add a To-do" }]);
    expect(ADD_TODO_FIELD_ID).toBe("record-add-todo");
  });
  it("no label (the timeline, and so its To-do field, is not on the page): no Add a To-do, the sentence stays (D3; mutation: render the button with a null label -> FAILS)", () => {
    focusProps.length = 0;
    const html = renderToStaticMarkup(createElement(NextUpBody, { ...props, addTodoLabel: null, view: { rows: [], undated: null } }));
    expect(html).toContain("Nothing coming up.");
    expect(html).not.toContain("<button");
    expect(focusProps).toEqual([]);
  });
});

describe("NextUpBody across a household (S-03 part 2b, C9)", () => {
  it("a row with `who` reads '… · Ana', on a booking and on a To-do; a row without one names no one (mutation: drop the who span -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(NextUpBody, { ...props, view: { undated: null, rows: [
      { kind: "task", id: "t", title: "Call back", detail: "Due Oct 20", overdue: false, who: { name: "Ana", typed: true } },
      { kind: "booking", id: "b", label: "Appointment · Fri, Oct 16 · 10:00 AM", who: { name: "Luis", typed: true } },
      { kind: "booking", id: "b2", label: "Appointment · Sat, Oct 17 · 9:00 AM", who: null },
    ] } }));
    expect(html.match(/data-next-up-who/g)).toHaveLength(2);
    // The name is typed text: lang="" so a Spanish page does not read "Ana" as a Spanish word (or the reverse).
    expect(html).toMatch(/Due Oct 20<\/span><span data-next-up-who="" class="[^"]*">\s*·\s*<span lang="">Ana<\/span><\/span>/);
    expect(html).toMatch(/Appointment · Fri, Oct 16 · 10:00 AM<span data-next-up-who="" class="[^"]*">\s*·\s*<span lang="">Luis<\/span><\/span>/);
  });

  it("a member with no name reads the page's own '(no name)' in the PAGE's language: no lang=\"\" on it (final review minor b; mutation: lang=\"\" on every who -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(NextUpBody, { ...props, view: { undated: null, rows: [
      { kind: "booking", id: "b", label: "Appointment · Fri, Oct 16 · 10:00 AM", who: { name: "(sin nombre)", typed: false } },
    ] } }));
    expect(html).toMatch(/<span data-next-up-who="" class="[^"]*">\s*·\s*<span>\(sin nombre\)<\/span><\/span>/);
    expect(html).not.toContain('lang=""');
  });
});
