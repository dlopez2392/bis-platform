import { describe, it, expect } from "vitest";
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
  it("passes undoContactBusinessAction as undoWith, with the save's payload (mutation: drop the undoWith prop -> FAILS)", () => {
    expect(src).toMatch(/undoWith=\{\(payload\) => undoContactBusinessAction\(accountId, contactId, payload as BusinessUndo\)\}/);
  });
  it("saves through setContactBusinessAction, never the generic field action", () => {
    expect(src).toMatch(/save=\{\(v\) => setContactBusinessAction\(accountId, contactId, v\)\}/);
    expect(src).not.toMatch(/updateContactFieldAction/);
  });
});
