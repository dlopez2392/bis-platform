import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InlineField } from "./inline-field";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/language-options";
import { formatDateUTC } from "@/lib/format";
import { m } from "@/lib/messages";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "inline-field.tsx"), "utf8");
const save = async () => ({ ok: true as const });

/**
 * I9 (whole-branch review): an options field shows the option's LABEL, not
 * its stored value — "Español", never the raw code "es" — both on the
 * button at rest and in that button's accessible name (aria-label REPLACES
 * the text content as the name, so both have to say it).
 */
describe("InlineField with options shows the option label (I9)", () => {
  const html = (value: string | null) =>
    renderToStaticMarkup(createElement(InlineField, { label: "Language", value, options: [...LANGUAGE_OPTIONS], save }));

  it("at rest the button reads \"Español\" and so does its accessible name (mutation: render `shown` instead of the option label → FAILS)", () => {
    const out = html("es");
    expect(out).toContain(">Español</button>");
    expect(out).toContain('aria-label="Edit Language: Español"');
    expect(out).not.toContain(": es\"");
  });

  it("an unknown stored value is shown as-is rather than hidden (mutation: render \"\" when no option matches → FAILS)", () => {
    expect(html("fr")).toContain(">fr</button>");
  });
});

/**
 * Source-text pin — the house pattern for a control with no DOM harness
 * (alert-phone-card.test.ts:7-12). The options arm's <select> is a NATIVE
 * field, so it must wear `nativeFieldClass` (ui/input.tsx), the one class
 * string that gives native controls the Input's own tokens — not a
 * hand-copied border/radius set that drifts from it.
 */
describe("InlineField's options <select> uses nativeFieldClass", () => {
  it("styles the select with nativeFieldClass (mutation: replace it with a literal class string → FAILS)", () => {
    const select = src.slice(src.indexOf("<select"), src.indexOf("</select>"));
    expect(select).toContain('className={cn(nativeFieldClass, "h-8")}');
  });
});

/**
 * S-02 §6 row 3: whether Undo is offered and which ONE writer it runs is
 * decided by planInlineUndo (lib/contacts/inline-save.ts, pinned there by
 * behaviour). What is left to pin here, by source text (no DOM harness in
 * this package), is that the component asks it and runs nothing else.
 */
describe("InlineField delegates Undo and the saved view to lib/contacts/inline-save", () => {
  it("plans Undo from THIS save's own payloads (mutation: hand it a client-captured value -> FAILS)", () => {
    const call = src.match(/const undo = planInlineUndo\(\{[^}]*\}\);/)?.[0] ?? "";
    expect(call).toMatch(/phoneUndo: result\.undo,/);
    expect(call).toMatch(/ownUndo: result\.undoPayload,/);
    // `undoWith` exactly as the prop arrived: the shorthand, never `undoWith: <anything>`
    // (mutations: `undoWith: undefined`; `undoWith: field === "phone" ? undoWith : undefined` -> FAIL).
    // S-10 T3 added `locale` after it (the field's own language, for commitInlineUndo's refusal),
    // so this no longer requires undoWith to be the LAST property, only a bare shorthand.
    expect(call).toMatch(/[\s,{]undoWith,/);
    expect(call).not.toMatch(/undoWith\s*:/);
  });
  it("offers Undo exactly when one is planned, and runs only that write (mutation: a second write beside it -> FAILS)", () => {
    expect(src).toMatch(/action: undo\s*\?/);
    expect(src).toMatch(/onClick: \(\) => \{\s*void undo\(\)\.then\(\(r\) => \{/);
    expect(src).not.toMatch(/commitInlineUndo/);
  });
  it("shows the server's stored spelling and its message (mutation: show the typed text -> FAILS)", () => {
    expect(src).toMatch(/const view = inlineSavedView\(norm\.value, label, result, locale\);/);
    expect(src).toMatch(/committed\.current = view\.shown;\s*setShown\(view\.shown\);/);
  });
});

/**
 * S-02 §8: an empty field may name what belongs there ("Role, like Madre or
 * Dueño") instead of the generic "Add…". The placeholder is shown, never
 * stored: a filled field shows its value, and the accessible name still
 * carries the label first.
 */
describe("InlineField's placeholder", () => {
  const html = (value: string | null, placeholder?: string) =>
    renderToStaticMarkup(createElement(InlineField, { label: "Role", value, field: "source", save, placeholder }));

  it("an empty field shows the placeholder in place of the generic empty text (mutation: ignore the prop -> FAILS)", () => {
    const out = html(null, "Role, like Madre");
    expect(out).toContain(">Role, like Madre</button>");
    expect(out).toContain('aria-label="Edit Role: Role, like Madre"');
  });

  it("a filled field shows its value, and no placeholder means the generic empty text (mutation: always show the placeholder -> FAILS)", () => {
    expect(html("Madre", "Role, like Madre")).toContain(">Madre</button>");
    expect(html(null)).toContain(">Add…</button>");
  });
});

describe("InlineField's value at rest wraps inside its host (design check 1a: a long First name pushed a 320px record page to 389)", () => {
  it("a 60-character unbroken value breaks anywhere on the display button, for every host (mutation: drop [overflow-wrap:anywhere] -> FAILS)", () => {
    const LONG = "MaximilianaGuadalupeHernandezVillarrealDeLaGarzaYMontemayorA";
    expect(LONG).toHaveLength(60);
    const out = renderToStaticMarkup(createElement(InlineField, { label: "First name", value: LONG, field: "first_name", save }));
    const button = out.match(/^<button[^>]*>/)?.[0] ?? "";
    expect(button).toContain("[overflow-wrap:anywhere]");
    expect(button).toContain("block w-full");
    expect(out).toContain(`>${LONG}</button>`);
  });
});

/**
 * Final review minor 11: a caller that must not remount the field mid-edit
 * (the Business name) is told when editing starts and stops. Every change of
 * `editing` goes through ONE setter that also tells `onEditingChange`, so no
 * path (click, commit, Esc) can change it silently.
 */
describe("InlineField reports every editing change through onEditingChange", () => {
  it("the state setter is called in exactly one place, the wrapper that also calls onEditingChange (mutation: call setEditingState directly anywhere else -> FAILS)", () => {
    expect(src).toContain("const [editing, setEditingState] = useState(false);");
    expect(src.match(/setEditingState\(/g)).toHaveLength(1);
    expect(src).toContain("const setEditing = (next: boolean) => { setEditingState(next); onEditingChange?.(next); };");
  });
});

describe("InlineField's rule arm, date display and locale (places spec §8)", () => {
  const html = (props: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(InlineField, { label: "Dirección", value: null, save, rule: { kind: "text", max: 300, required: false }, ...props } as never));

  it("at rest a date field prints the date in the reader's language, never the stored YYYY-MM-DD (mutation: ignore display -> FAILS)", () => {
    const en = html({ label: "Installed", value: "2019-03-03", rule: { kind: "date", required: false }, inputType: "date", display: "date" });
    expect(en).toContain(`>${formatDateUTC("2019-03-03", "en")}</button>`);
    expect(en).not.toContain(">2019-03-03<");
    const es = html({ label: "Instalado", value: "2019-03-03", rule: { kind: "date", required: false }, inputType: "date", display: "date", locale: "es" });
    expect(es).toContain(`>${formatDateUTC("2019-03-03", "es")}</button>`);
  });
  it("locale es: the accessible name and the empty text are Spanish (mutation: read m[...] without the locale -> FAILS)", () => {
    const out = html({ locale: "es" });
    expect(out).toContain(`>${m["inline.empty.es"]}</button>`);
    expect(out).toContain(`aria-label="${m["inline.edit.es"].replace("{label}", "Dirección")}: ${m["inline.empty.es"]}"`);
  });
  it("no locale is English, as every existing caller expects", () => {
    expect(html({})).toContain('aria-label="Edit Dirección: Add…"');
  });
});

describe("InlineField multiline at rest keeps its line breaks", () => {
  const html = (props: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(InlineField, { label: "How to get there", value: "Past the canal\nGate code 1234", save, rule: { kind: "text", max: 1000, required: false }, ...props } as never));
  it("a multiline field's button preserves the typed line breaks, a single-line one does not need to (mutation: drop the multiline whitespace class -> FAILS)", () => {
    expect(html({ inputType: "multiline" })).toMatch(/<button[^>]*class="[^"]*\bwhitespace-pre-line\b/);
    expect(html({})).not.toContain("whitespace-pre-line");
  });
});
