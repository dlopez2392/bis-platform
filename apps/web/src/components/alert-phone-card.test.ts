import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Source-text pins — the house pattern for a component this repo has no
 * render harness for (weekly-report-card.test.ts's own comment: "this repo
 * has no component harness, so structure is what these tests pin"). Every
 * claim below is proven by a mutation actually run against the component
 * (see the task report), not merely asserted.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const card = readFileSync(path.join(here, "alert-phone-card.tsx"), "utf8");

describe("AlertPhoneCard", () => {
  it("uses useFormSubmit, never a bare form action (mutation: swap onSubmit for action= → FAILS)", () => {
    expect(card).toContain("useFormSubmit");
    expect(card).not.toMatch(/<form\s+action=/);
  });

  it("posts the phone as a named field the action can read", () => {
    expect(card).toContain('name="alertPhone"');
  });

  it("gates the editable field behind isAgency — the client branch never emits it (mutation: drop the isAgency ternary → FAILS)", () => {
    const fieldIdx = card.indexOf('name="alertPhone"');
    const splitIdx = card.indexOf(") : (");
    expect(fieldIdx).toBeGreaterThan(-1);
    expect(splitIdx).toBeGreaterThan(-1);
    expect(fieldIdx).toBeLessThan(splitIdx);
  });

  it("never shows the SMS-readiness caveat to a client — smsNotReady stays inside the agency branch (mutation: move the Notice outside the isAgency branch → FAILS)", () => {
    const notReadyIdx = card.indexOf("smsNotReady");
    const splitIdx = card.indexOf(") : (");
    expect(notReadyIdx).toBeGreaterThan(-1);
    expect(splitIdx).toBeGreaterThan(-1);
    expect(notReadyIdx).toBeLessThan(splitIdx);
  });

  it("never renders a Save button in the client's read-only branch (mutation: add SubmitButton to the client branch → FAILS)", () => {
    const splitIdx = card.indexOf(") : (");
    expect(splitIdx).toBeGreaterThan(-1);
    const clientBranch = card.slice(splitIdx);
    expect(clientBranch).not.toContain("SubmitButton");
  });

  it("toasts both the save and the save-time self-loop warning, never only the save (mutation: drop the toast.warning call → FAILS)", () => {
    expect(card).toContain('toast.success(m["settings.alertPhoneSaved"])');
    expect(card).toContain("toast.warning(result.warning)");
  });
});
