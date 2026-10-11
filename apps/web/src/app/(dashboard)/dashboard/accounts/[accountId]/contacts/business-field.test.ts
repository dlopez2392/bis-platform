import { describe, it, expect, vi } from "vitest";
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

/**
 * Task 6 fix round 1, I1: the Business name is the contact's business GROUP's
 * name, so a Groups card write (a rename, an add, a create) changes it under
 * the field. InlineField keeps its own `shown` state and ignores a new
 * `value`, so the field is keyed by the value: the refreshed drawer row or
 * page hands it the new name, and it shows it.
 */
vi.mock("./actions", () => ({ setContactBusinessAction: vi.fn(), undoContactBusinessAction: vi.fn() }));
const { BusinessInlineField } = await import("./business-field");

describe("BusinessInlineField follows a new value from the server (fix round 1, I1)", () => {
  it("is keyed by its value, so a changed name remounts the field (mutation: drop the key -> FAILS)", () => {
    const el = BusinessInlineField({ accountId: "a1", contactId: "c1", value: "Acme Roofing" });
    expect(el.key).toBe("Acme Roofing");
    expect(BusinessInlineField({ accountId: "a1", contactId: "c1", value: null }).key).toBe("");
  });
});
