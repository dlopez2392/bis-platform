import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { m } from "@/lib/messages";

/**
 * Source-text pins — the house pattern for a component this repo has no
 * render harness for (weekly-report-card.test.ts's own comment: "this repo
 * has no component harness, so structure is what these tests pin"). Every
 * claim below is proven by a mutation actually run against the component
 * (see the task report), not merely asserted.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const card = readFileSync(path.join(here, "alert-phone-card.tsx"), "utf8");
// Whitespace-collapsed for the multi-word phrase checks below — a doc
// comment's own line wrap (each continuation line starts " * ") would
// otherwise break a literal multi-word match without the phrase actually
// being gone, which is exactly the kind of pass that proves nothing. Strip
// the JSDoc gutter (" * ") BEFORE collapsing whitespace, or the leftover
// "*" sits between the two halves of the phrase and the match still misses.
const cardFlat = card.replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");

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

  it("never shows the agency's carrier-facing readiness Notice to a client — that key stays inside the agency branch (mutation: move it outside the isAgency branch → FAILS)", () => {
    const splitIdx = card.indexOf(") : (");
    expect(splitIdx).toBeGreaterThan(-1);
    const agencyBranch = card.slice(0, splitIdx);
    const clientBranch = card.slice(splitIdx);
    expect(agencyBranch).toContain("settings.alertPhoneNotReady");
    expect(clientBranch).not.toContain("settings.alertPhoneNotReady");
  });

  it("gates the client's destination sentence on the same send-readiness gate — never a bare present-tense claim when sending is not possible (mutation: drop the smsNotReady check in the client branch → FAILS)", () => {
    expect(card).toContain("settings.alertPhoneClientNotReady");
    const splitIdx = card.indexOf(") : (");
    expect(splitIdx).toBeGreaterThan(-1);
    const clientBranch = card.slice(splitIdx);
    expect(clientBranch).toContain("smsNotReady");
    // The qualified-claim copy, referenced via its own pre-split lead/tail
    // pair (setup-shell.tsx's own {steps}-split technique) — not the raw
    // message key, which is read once outside the ternary.
    expect(clientBranch).toContain("clientNotReadyLead");
  });

  it("renders the client's phone number in a monospaced chip, matching step-shared.tsx's NumberChip, never raw prose (mutation: revert to alertPhone interpolated straight into the sentence → FAILS)", () => {
    const splitIdx = card.indexOf(") : (");
    expect(splitIdx).toBeGreaterThan(-1);
    const clientBranch = card.slice(splitIdx);
    expect(clientBranch).toContain("NumberChip");
    expect(clientBranch).not.toMatch(/\.replace\(\s*"\{value\}"/);
  });

  it("links the agency's readiness notice to the account's own checklist route, not a bare mention (mutation: print the words with no href → FAILS)", () => {
    expect(card).toMatch(/href=\{`\/dashboard\/accounts\/\$\{accountId\}\/checklist`\}/);
  });

  it("no longer claims a BrandingPanel precedent that does not exist (mutation: restore 'the same split BrandingPanel already draws' → FAILS)", () => {
    expect(cardFlat).not.toMatch(/same split BrandingPanel already draws/);
  });

  it("confirms the save with the feature's own name, not the database column (mutation: revert to 'Alert phone updated' → FAILS)", () => {
    expect(m["settings.alertPhoneSaved"]).toBe(`${m["settings.alertPhone"]} updated`);
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
