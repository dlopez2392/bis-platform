import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InlineField } from "./inline-field";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/language-options";

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
 * S-02 §6 row 3: a field whose save hands back its OWN server-built undo
 * (the Business name) undoes with exactly that payload through `undoWith`,
 * never by re-saving the prior text — re-saving "Acme" would create a new
 * group rather than restore the membership the save replaced. Source-text
 * pin, the file's house pattern (no DOM harness in this package).
 */
describe("InlineField.undoWith routes Undo to the save's own payload", () => {
  it("Undo calls undoWith with the payload this save returned (mutation: always commitInlineUndo → FAILS)", () => {
    expect(src).toMatch(/const ownUndo = undoWith \? result\.undoPayload : undefined;/);
    expect(src).toMatch(/undoWith && ownUndo !== undefined\s*\?\s*undoWith\(ownUndo\)/);
  });
  it("an undoWith field offers Undo only when the save returned a payload (mutation: fall back to normalize(prior).ok → FAILS)", () => {
    expect(src).toMatch(/: undoWith \? ownUndo !== undefined\s*: normalize\(prior\)\.ok/);
  });
});
