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
const es = makeTr("es");
/** The real buttons, never the checkbox (Radix draws its box as a `role="checkbox"` button). */
const buttons = (h: string) => (h.match(/<button[^>]*>.*?<\/button>/g) ?? []).filter((b) => !b.includes('role="checkbox"'));
const variant = (b: string) => /data-variant="([a-z]+)"/.exec(b)?.[1];
const text = (b: string) => b.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("BookingUndoForm (the popover's own view): exactly one primary (rule 8)", () => {
  const form = (over: Partial<Parameters<typeof BookingUndoForm>[0]> = {}) => renderToStaticMarkup(createElement(BookingUndoForm, {
    tr: en, verb: "booked Thu, Oct 22, 10:00 AM", detail: null, notify: { name: "Ana" }, ticked: true, busy: false,
    onTicked: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn(), ...over,
  }));

  it("ONE primary (Undo), one ghost Cancel (mutation: make Cancel default -> FAILS)", () => {
    const b = buttons(form());
    expect(b.map((x) => [text(x), variant(x)])).toEqual([["Cancel", "ghost"], ["Undo", "default"]]);
  });

  it("the box is the kit's Checkbox, not the browser's (design I-1): a role=checkbox, pre-ticked (mutation: a native input -> FAILS)", () => {
    // Radix keeps a hidden, aria-hidden bubble input for forms; no input a reader or a browser draws as the box.
    for (const input of form().match(/<input[^>]*type="checkbox"[^>]*>/g) ?? []) expect(input).toContain('aria-hidden="true"');
    expect(form()).toMatch(/<button[^>]*role="checkbox" aria-checked="true"[^>]*data-slot="checkbox"/);
    expect(form({ ticked: false })).toMatch(/<button[^>]*role="checkbox" aria-checked="false"/);
  });

  it("its label is a full-size target on a phone, the box at the first line, and it names the box (design I-1)", () => {
    const label = /<label[^>]*>/.exec(form())![0];
    expect(label).toMatch(/min-h-11/);
    expect(label).toMatch(/md:min-h-8/);
    expect(label).toMatch(/items-start/);
    const forId = /for="([^"]+)"/.exec(label)![1]!;
    const box = /<button[^>]*role="checkbox"[^>]*>/.exec(form())![0];
    expect(box).toContain(`id="${forId}"`);
  });

  it("the label names who gets told", () => {
    expect(text(form())).toContain("Let Ana know by email");
  });

  it("no email on file: the sentence instead of a checkbox (mutation: always show the checkbox -> FAILS)", () => {
    const html = form({ notify: { none: "Ana has no email on file, so they won't be told. Call them if they need to know." } });
    expect(html).not.toContain('role="checkbox"');
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

  it("the buttons wrap at 360 px rather than overflow (design I-7)", () => {
    expect(form()).toContain('class="flex flex-wrap justify-end gap-2"');
  });
});

describe("ContactUndoForm (the dialog's own view): the ONE primary disabled until the typed name matches", () => {
  const form = (typed: string, over: Partial<Parameters<typeof ContactUndoForm>[0]> = {}) => renderToStaticMarkup(createElement(ContactUndoForm, {
    tr: en, persona: "Sofía", contactName: "Ana Ruiz", typed, busy: false, fromChat: false,
    onTyped: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn(), ...over,
  }));
  const confirmTag = (html: string) => /<button[^>]*data-variant="destructive"[^>]*>/.exec(html)![0];

  it("disabled until it matches exactly (mutation: drop the disabled check -> FAILS)", () => {
    expect(confirmTag(form(""))).toContain('disabled=""');
    expect(confirmTag(form("Ana"))).toContain('disabled=""');
    expect(confirmTag(form("Ana Ruiz"))).not.toContain('disabled=""');
  });

  it("the body names the persona and says the call stays; a visible label asks to type the name (design M-2; mutation: drop the label -> FAILS)", () => {
    expect(text(form(""))).toContain("Sofía added this customer");
    expect(text(form(""))).toContain("the call stays in Calls");
    const label = /<label[^>]*>.*?<\/label>/.exec(form(""))![0];
    expect(text(label)).toBe("Type Ana Ruiz to confirm");
    expect(label).toContain("<input");
  });

  it("the name is its own span, in no language, set off like the purge form's (design M-2)", () => {
    expect(form("")).toContain('<span lang="" class="font-medium text-card-foreground">Ana Ruiz</span>');
    expect(form("", { tr: es })).toMatch(/Escriba <span lang="" class="font-medium text-card-foreground">Ana Ruiz<\/span> para confirmar/);
  });

  it("a near miss is marked and says why; an empty or matching box is not (design M-2; mutation: always invalid -> FAILS)", () => {
    const miss = form("Ana");
    const input = /<input[^>]*>/.exec(miss)![0];
    expect(input).toContain('aria-invalid="true"');
    const hintId = /aria-describedby="([^"]+)"/.exec(input)![1]!;
    expect(miss).toContain(`id="${hintId}"`);
    expect(text(miss)).toContain("The name doesn't match. Type it exactly as shown.");
    for (const ok of [form(""), form("Ana Ruiz")]) {
      expect(ok).not.toContain('aria-invalid="true"');
      expect(text(ok)).not.toContain("doesn't match");
    }
  });

  it("a customer the web chat added: the body speaks of the chat, never a call (review M-a; mutation: one body for every actor -> FAILS)", () => {
    const h = text(form("", { fromChat: true }));
    expect(h).toContain("from the website chat");
    expect(h).not.toContain("Calls");
  });

  it("ONE primary, destructive; a ghost Cancel; the row wraps (design I-7)", () => {
    const b = buttons(form(""));
    expect(b.map((x) => [text(x), variant(x)])).toEqual([["Cancel", "ghost"], ["Remove customer", "destructive"]]);
    expect(form("")).toContain('class="flex flex-wrap justify-end gap-2"');
  });
});
