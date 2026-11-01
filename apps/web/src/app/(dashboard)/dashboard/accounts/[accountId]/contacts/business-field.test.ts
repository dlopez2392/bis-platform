import { describe, it, expect, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "business-field.tsx"), "utf8");

/**
 * Wiring pin (no DOM harness in this package): the Business name saves
 * through its own action and undoes through the server's own payload. Without
 * `undoWith`, InlineField would fall back to re-saving the prior text, which
 * relinks the existing group but loses its role, pays flag and age.
 * planInlineUndo's behaviour is pinned in lib/contacts/inline-save.test.ts.
 */
describe("BusinessInlineField wiring", () => {
  it("passes undoContactBusinessAction as undoWith, with the save's payload, in the field's own language (S-10 T3; mutation: drop the undoWith prop -> FAILS)", () => {
    expect(src).toMatch(/undoWith=\{\(payload\) => undoContactBusinessAction\(accountId, contactId, payload as BusinessUndo, locale\)\}/);
  });
  it("saves through setContactBusinessAction, never the generic field action", () => {
    expect(src).toMatch(/save=\{\(v\) => setContactBusinessAction\(accountId, contactId, v, locale\)\}/);
    expect(src).not.toMatch(/updateContactFieldAction/);
  });
});

/**
 * Task 6 fix round 1, I1, and final review minor 11: the Business name is the
 * contact's business GROUP's name, so a Groups card write (a rename, an add, a
 * create) changes it under the field. InlineField keeps its own `shown` state
 * and ignores a new `value`, so the field is keyed by the value; but the key
 * is held while the operator is editing (followedFieldKey, pinned by
 * behaviour in lib/contacts/inline-save.test.ts), so a refresh mid-edit never
 * remounts the input and throws the typed text away. What is left to pin here,
 * by source text (no DOM harness in this package), is the wiring.
 */
describe("BusinessInlineField follows a new value from the server, but not mid-edit (fix round 1, I1; minor 11)", () => {
  it("keys InlineField by followedFieldKey over its own editing state (mutation: key={value ?? \"\"} again -> FAILS)", () => {
    expect(src).toMatch(/const next = followedFieldKey\(editing, key, value\);/);
    expect(src).toMatch(/key=\{next\}/);
    expect(src).not.toMatch(/key=\{value/);
  });
  it("learns when editing starts and stops from InlineField itself (mutation: drop onEditingChange -> FAILS)", () => {
    expect(src).toMatch(/onEditingChange=\{setEditing\}/);
  });
});

vi.mock("./actions", () => ({ setContactBusinessAction: vi.fn(), undoContactBusinessAction: vi.fn() }));
const { BusinessInlineField } = await import("./business-field");
const { LocaleProvider } = await import("@/components/locale-provider");

describe("BusinessInlineField renders the stored name", () => {
  it("shows the server's value at rest, and the empty prompt for none", () => {
    expect(renderToStaticMarkup(createElement(BusinessInlineField, { accountId: "a1", contactId: "c1", value: "Acme Roofing" })))
      .toContain(">Acme Roofing</button>");
    expect(renderToStaticMarkup(createElement(BusinessInlineField, { accountId: "a1", contactId: "c1", value: null })))
      .not.toContain(">null</button>");
  });
});

describe("BusinessInlineField in Spanish (S-03 part 3 §10.1)", () => {
  it("names itself Nombre del negocio (mutation: keep m[\"contact.company\"] -> FAILS)", () => {
    const out = renderToStaticMarkup(createElement(LocaleProvider, { locale: "es" } as ComponentProps<typeof LocaleProvider>,
      createElement(BusinessInlineField, { accountId: "a1", contactId: "c1", value: null })));
    expect(out).toContain("Nombre del negocio");
    expect(out).not.toContain("Business name");
  });
});
