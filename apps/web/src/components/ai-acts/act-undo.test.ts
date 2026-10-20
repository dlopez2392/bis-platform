import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeTr } from "@/lib/record/copy";
import { BookingUndoForm, ContactUndoForm } from "./act-undo";

/**
 * The popover and the dialog's own presentational bodies (item 8c, plan Task 6; the `DocumentPurgeForm`
 * shape): no Popover/Dialog portal here, so no DOM is needed to read what a reader sees.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const en = makeTr("en");
const buttons = (h: string) => h.match(/<button[^>]*>.*?<\/button>/g) ?? [];
const variant = (b: string) => /data-variant="([a-z]+)"/.exec(b)?.[1];
const text = (b: string) => b.replace(/<[^>]*>/g, "");

describe("BookingUndoForm (the popover's own view): exactly one primary (rule 8)", () => {
  const form = (over: Partial<Parameters<typeof BookingUndoForm>[0]> = {}) => renderToStaticMarkup(createElement(BookingUndoForm, {
    tr: en, verb: "booked Thu, Oct 22, 10:00 AM", detail: null, notify: { name: "Ana" }, ticked: true, busy: false,
    onTicked: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn(), ...over,
  }));

  it("ONE primary (Undo), one ghost Cancel (mutation: make Cancel default -> FAILS)", () => {
    const b = buttons(form());
    expect(b.map((x) => [text(x), variant(x)])).toEqual([["Cancel", "ghost"], ["Undo", "default"]]);
  });

  it("the checkbox is pre-ticked, a real input (mutation: ticked=false renders unchecked)", () => {
    const html = form();
    expect(html).toMatch(/<input id="[^"]+" type="checkbox" checked=""/);
    expect(form({ ticked: false })).toMatch(/<input id="[^"]+" type="checkbox"(?! checked)/);
  });

  it("the label names who gets told", () => {
    expect(text(form())).toContain("Let Ana know by email");
  });

  it("no email on file: the sentence instead of a checkbox (mutation: always show the checkbox -> FAILS)", () => {
    const html = form({ notify: { none: "Ana has no email on file, so they won't be told. Call them if they need to know." } });
    expect(html).not.toContain("type=\"checkbox\"");
    expect(html).toContain("data-ai-act-no-email");
  });

  it("the row's own sentence is shown again, so the choice is never detached from what it undoes", () => {
    expect(text(form())).toContain("booked Thu, Oct 22, 10:00 AM");
    expect(text(form({ detail: "From Oct 20" }))).toContain("booked Thu, Oct 22, 10:00 AM · From Oct 20");
  });

  it("busy disables both buttons", () => {
    const b = buttons(form({ busy: true }));
    expect(b.every((x) => x.includes('disabled=""'))).toBe(true);
  });
});

describe("ContactUndoForm (the dialog's own view): the ONE primary disabled until the typed name matches", () => {
  const form = (typed: string, contactName = "Ana Ruiz") => renderToStaticMarkup(createElement(ContactUndoForm, {
    tr: en, persona: "Sofía", contactName, typed, busy: false, onTyped: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn(),
  }));
  const confirmTag = (html: string) => /<button[^>]*data-variant="destructive"[^>]*>/.exec(html)![0];

  it("disabled until it matches exactly (mutation: drop the disabled check -> FAILS)", () => {
    expect(confirmTag(form(""))).toContain('disabled=""');
    expect(confirmTag(form("Ana"))).toContain('disabled=""');
    expect(confirmTag(form("Ana Ruiz"))).not.toContain('disabled=""');
  });

  it("the body names the persona and the customer, and asks to type the name (mutation: drop Type {name} -> FAILS)", () => {
    expect(text(form(""))).toContain("Sofía added this customer");
    expect(text(form(""))).toContain("Type Ana Ruiz to confirm");
  });

  it("ONE primary, destructive; a ghost Cancel", () => {
    const b = buttons(form(""));
    expect(b.map((x) => [text(x), variant(x)])).toEqual([["Cancel", "ghost"], ["Remove customer", "destructive"]]);
  });
});
