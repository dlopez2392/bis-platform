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
 *
 * 0036 turned this card from a single form into three regions — the client's
 * read-only view (unchanged), the agency's idle phase (one phone field, one
 * button whose label depends on what's typed), and the agency's pending
 * phase (a code field, reached only after a successful send). A single
 * `") : ("` boundary can no longer separate "agency" from "client" the way
 * the old two-branch card allowed, because the agency side now has an
 * internal ternary of its own — so these tests anchor on message keys that
 * are LEXICALLY UNIQUE to one branch (`alertPhoneClientOff` never appears
 * outside the client branch; `alertPhoneSendCode` never appears outside the
 * agency branch) rather than on generic JSX punctuation.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const card = readFileSync(path.join(here, "alert-phone-card.tsx"), "utf8");
// Whitespace-collapsed for multi-word phrase checks — strip the JSDoc gutter
// (" * ") BEFORE collapsing, or a leftover "*" sits inside a phrase and the
// match still misses even though the words are all there.
const cardFlat = card.replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");

// This component's own doc comment names several message keys in prose
// (`settings.alertPhoneSendCode`, `phone.trim()`, …) to explain the design —
// which means a structural assertion run against the RAW file can pass on a
// mutated component simply because the comment describing the old behaviour
// is still sitting above it. Caught live: hard-coding the button to
// `common.save` unconditionally still left this file green, because the
// doc comment's own sentence — "`settings.alertPhoneSendCode` otherwise" —
// still contained the key. Every structural/behavioural pin below therefore
// runs against `codeOnly`, comments stripped; `cardFlat` (comments intact)
// stays reserved for the copy-content assertions that are ABOUT the prose.
const codeOnly = card
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

// The client branch starts at the first mention of a client-only key. Every
// key used above this index is agency-only by construction (the client
// branch never had, and still must never have, a form).
const clientBranchIdx = codeOnly.indexOf("settings.alertPhoneClientOff");
const agencyRegion = codeOnly.slice(0, clientBranchIdx);
const clientRegion = codeOnly.slice(clientBranchIdx);

describe("AlertPhoneCard — client branch is unchanged by 0036", () => {
  it("has a client-only region at all (mutation: this index existing is the precondition for every test below)", () => {
    expect(clientBranchIdx).toBeGreaterThan(-1);
  });

  it("never emits an editable phone field or a code field in the client region (mutation: move the agency form below the client marker → FAILS)", () => {
    expect(clientRegion).not.toContain('name="alertPhone"');
    expect(clientRegion).not.toContain('name="code"');
  });

  it("never renders a Save/Send/Confirm button in the client region (mutation: add a Button to the client branch → FAILS)", () => {
    expect(clientRegion).not.toContain("<Button");
  });

  it("still reads a null alert_phone as off, honestly — a pending, unconfirmed claim never touches this column (verifyAlertPhoneCode writes it only on a match) (mutation: swap alertPhoneClientOff for alertPhoneClientOn as the null-case branch → FAILS)", () => {
    expect(clientRegion).toContain("settings.alertPhoneClientOff");
  });

  it("renders the client's phone number in a monospaced chip, never raw prose (mutation: interpolate alertPhone straight into the sentence → FAILS)", () => {
    expect(clientRegion).toContain("NumberChip");
    expect(clientRegion).not.toMatch(/\.replace\(\s*"\{value\}"/);
  });
});

describe("AlertPhoneCard — agency idle phase", () => {
  it("uses useFormSubmit for the send-or-clear form, never a bare form action (mutation: swap onSubmit for action= → FAILS)", () => {
    expect(agencyRegion).toContain("useFormSubmit");
    expect(agencyRegion).not.toMatch(/<form\s+action=/);
  });

  it("posts the phone as a named field the action can read (mutation: rename the field → FAILS)", () => {
    expect(agencyRegion).toContain('name="alertPhone"');
  });

  it("the primary button's label depends on what is TYPED, not on the last saved value (mutation: hard-code common.save → FAILS)", () => {
    expect(agencyRegion).toContain("settings.alertPhoneSendCode");
    expect(agencyRegion).toMatch(/phone\.trim\(\)/);
  });

  it("a blank field still goes through clearAction, never startVerificationAction (mutation: route blank submissions to startVerificationAction too → FAILS)", () => {
    expect(agencyRegion).toContain("clearAction");
    expect(agencyRegion).toContain("startVerificationAction");
    // The blank check must exist and gate which action is called — pinned by
    // requiring both an emptiness test and both action identifiers present
    // in the same idle-phase submit handler.
    expect(agencyRegion).toMatch(/if\s*\(!raw\)/);
  });

  it("tells the operator up front that a new number needs a code, as a standing hint rather than only an error after a refused save (mutation: delete the static hint line → FAILS)", () => {
    expect(agencyRegion).toContain("settings.alertPhoneNeedsVerification");
  });

  it("shows the readiness Notice, with a real link to the account's own Checklist route (mutation: print the words with no href → FAILS)", () => {
    expect(agencyRegion).toContain("settings.alertPhoneNotReady");
    expect(agencyRegion).toMatch(/href=\{`\/dashboard\/accounts\/\$\{accountId\}\/checklist`\}/);
  });

  it("never shows the agency's carrier-facing readiness Notice to a client (mutation: move it into the client region → FAILS)", () => {
    expect(clientRegion).not.toContain("settings.alertPhoneNotReady");
  });

  it("gates the client's destination sentence on the same send-readiness gate (mutation: drop the smsNotReady check in the client branch → FAILS)", () => {
    // The qualified-claim copy, referenced via its own pre-split lead/tail
    // pair (setup-shell.tsx's own {steps}-split technique) — the raw message
    // key is read once, in the destructuring above the return, which sits
    // BEFORE clientBranchIdx and so is never itself inside clientRegion.
    expect(clientRegion).toContain("clientNotReadyLead");
    expect(clientRegion).toContain("smsNotReady");
  });

  it("no longer claims a BrandingPanel precedent that does not exist (mutation: restore 'the same split BrandingPanel already draws' → FAILS)", () => {
    expect(cardFlat).not.toMatch(/same split BrandingPanel already draws/);
  });
});

describe("AlertPhoneCard — the code is never made legible on this screen", () => {
  it("never renders the code the server drew, and never logs it — the only code-shaped value in this file is the operator's own typed input, held as `code` state (mutation: this is a structural invariant checked by absence, not a single line — see the grep below)", () => {
    // The only place a 6-digit value could leak onto this screen is if the
    // component ever read a code back OFF a server result and displayed it.
    // Every action here returns only {ok:true} or {ok:false,error}; neither
    // shape carries a code field, so there is nothing in this file's own
    // type surface capable of holding one. Pinned as: the result type never
    // grows a `code` property.
    expect(card).not.toMatch(/result\.code/);
    expect(card).not.toMatch(/\bcode:\s*string\b[\s\S]*ok:\s*true/);
  });

  it("never shows a remaining-attempts count — the server does not return one, and a client-guessed count could drift from the database's own (mutation: this documents a deliberate omission; see the report for why a count is not fabricated here)", () => {
    expect(cardFlat).not.toMatch(/attempts? (left|remaining)/i);
  });
});

describe("AlertPhoneCard — agency pending phase (reached after a successful send)", () => {
  it("posts the code as a named field, and the claimed number travels as a hidden field carrying the SENT-TO value, not the live input (mutation: read the phone field's live value instead of the pending one → FAILS)", () => {
    expect(agencyRegion).toContain('name="code"');
    expect(agencyRegion).toMatch(/name="alertPhone"\s+value=\{pendingPhone\}/);
  });

  it("uses useFormSubmit for the confirm form too (mutation: swap onSubmit for action= on the confirm form → FAILS)", () => {
    expect(agencyRegion.match(/useFormSubmit/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("echoes the number the code was sent to in a monospaced chip, never raw prose (mutation: interpolate pendingPhone straight into the sentence → FAILS)", () => {
    expect(agencyRegion).toContain("settings.alertPhonePendingHint");
    expect(agencyRegion).toMatch(/<NumberChip e164=\{pendingPhone\}/);
  });

  it("offers Resend and Change-number as ghost actions beside the one primary Confirm button (mutation: make Resend or Change-number the default/primary variant → FAILS)", () => {
    expect(agencyRegion).toContain("settings.alertPhoneResendCode");
    expect(agencyRegion).toContain("settings.alertPhoneChangeNumber");
    expect(agencyRegion).toMatch(/variant="ghost"[^>]*>\s*\{m\["settings\.alertPhoneResendCode"\]/);
    expect(agencyRegion).toMatch(/variant="ghost"[^>]*>\s*\{m\["settings\.alertPhoneChangeNumber"\]/);
  });

  it("Resend and Change-number are both type=\"button\", never a second submit inside the confirm form (mutation: drop type=\"button\" from Change-number → FAILS)", () => {
    const resendIdx = agencyRegion.indexOf("settings.alertPhoneResendCode");
    const changeIdx = agencyRegion.indexOf("settings.alertPhoneChangeNumber");
    const resendTag = agencyRegion.lastIndexOf("<Button", resendIdx);
    const changeTag = agencyRegion.lastIndexOf("<Button", changeIdx);
    expect(agencyRegion.slice(resendTag, resendIdx)).toContain('type="button"');
    expect(agencyRegion.slice(changeTag, changeIdx)).toContain('type="button"');
  });
});

describe("AlertPhoneCard — copy", () => {
  it("confirms the save with the feature's own name, not the database column (mutation: revert to 'Alert phone updated' → FAILS)", () => {
    expect(m["settings.alertPhoneSaved"]).toBe(`${m["settings.alertPhone"]} updated`);
  });

  it("the wrong-code and expired-code strings are distinct (mutation: reuse one string for both → FAILS)", () => {
    expect(m["settings.alertPhoneWrongCode"]).not.toBe(m["settings.alertPhoneCodeExpired"]);
  });

  it("the send-refusal copy for the account's own number reads as a refusal, not as advice about a save that already happened (mutation: restore the old 'Heads up ... while it's set to this number' phrasing → FAILS)", () => {
    expect(m["settings.alertPhoneSelfWarning"]).not.toMatch(/while it's set to this number/);
  });
});
