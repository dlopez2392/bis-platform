import { describe, it, expect } from "vitest";
import { REACTIVATION_MIN_MONTHS, REACTIVATION_MAX_MONTHS, REACTIVATION_DEFAULT_MONTHS } from "@bis/db";
import { m } from "@/lib/messages";
import { REACTIVATION_DAILY_CAP } from "./caps";
import { defaultReactivationBody, reactivationSubject } from "./reactivation-copy";

/**
 * NO SEGMENT ASSERTION AND NO OPT-OUT MEASUREMENT IN THIS FILE, unlike every
 * sibling copy test: this recipe is EMAIL ONLY (spec decision 4), the
 * due-row carries no phone number at all, and `sendAutomationSms` is never
 * reached. An email body has no GSM-7 budget and no disclosure appended, so
 * pinning an encoding or a segment count here would assert a property of a
 * string nothing measures.
 */
describe("the reactivation check-in's copy", () => {
  it("names the brand and reads like a door left open, not a campaign", () => {
    const body = defaultReactivationBody("Rio Roofing");
    expect(body).toContain("Rio Roofing");
    expect(body.toLowerCase()).toContain("it's been a while");
    expect(body.toLowerCase()).toContain("reply");
  });

  it("carries NO OFFER, NO DISCOUNT and NO LINK — the three things that turn a note into marketing", () => {
    // Mutation: add "10% off" to `automations.reactivation.defaultBody` →
    // the "%" and the " off" assertions both red BY NAME. This message
    // reaches someone who has not thought about this business in nine
    // months, and a discount is a business decision nobody has taken.
    for (const name of ["Rio Roofing", ""]) {
      const body = defaultReactivationBody(name);
      expect(body, name).not.toContain("http");
      expect(body, name).not.toContain("www.");
      expect(body, name).not.toContain("%");
      expect(body.toLowerCase(), name).not.toContain(" off");
      expect(body.toLowerCase(), name).not.toContain("discount");
      expect(body.toLowerCase(), name).not.toContain("deal");
    }
  });

  it("the subject names the brand, is plain, and carries no exclamation mark", () => {
    // A subject line that looks like a newsletter gets treated as one.
    // Mutation: add `!` to `automations.reactivation.subject` → this reds
    // BY NAME.
    expect(reactivationSubject("Rio Roofing")).toBe("A note from Rio Roofing");
    expect(reactivationSubject("Rio Roofing")).not.toContain("!");
    expect(m["automations.reactivation.subjectNoName"]).not.toContain("!");
  });

  it("drops the naming clause when there is no brand name", () => {
    // THE EXACT STRING, not `not.toContain("undefined")` + a substring:
    // deleting the blank-name branch yields "Hi, it's    . It's been a
    // while…", which satisfies both of those and reds nothing.
    // Mutation: delete either `if (!brandName.trim())` branch → this reds BY NAME.
    expect(defaultReactivationBody("   ")).toBe(m["automations.reactivation.defaultBodyNoName"]);
    expect(reactivationSubject("   ")).toBe(m["automations.reactivation.subjectNoName"]);
    expect(defaultReactivationBody("")).toBe(m["automations.reactivation.defaultBodyNoName"]);
    expect(reactivationSubject("")).toBe(m["automations.reactivation.subjectNoName"]);
  });

  it("survives a company name containing a String.replace special", () => {
    expect(defaultReactivationBody("A $& B")).toContain("A $& B");
    expect(reactivationSubject("A $& B")).toContain("A $& B");
  });

  // The footer line's cases moved to `marketing-copy.test.ts` with the
  // function (now `marketingFooterReason`), when the referral ask started
  // printing the same line (B21, 2026-09-23).

  it("carries no internal milestone code and no template syntax", () => {
    for (const s of [defaultReactivationBody("Rio Roofing"), reactivationSubject("Rio Roofing")]) {
      expect(s).not.toMatch(/\bM\d[a-z]?\b/);
      expect(s).not.toContain("{{");
    }
  });

  it("the month-range copy names the range the parser actually enforces", () => {
    const range = `between ${REACTIVATION_MIN_MONTHS} and ${REACTIVATION_MAX_MONTHS}`;
    for (const key of ["automations.reactivation.monthsHint", "automations.reactivation.monthsInvalid"] as const) {
      expect(m[key].toLowerCase(), key).toContain(range);
    }
    // Mutation: set REACTIVATION_MAX_MONTHS to 12 → both keys still read
    // "between 6 and 18" and this reds.

    // AND THE DEFAULT, restated in the same sentence in WORDS ("Nine is a
    // good default…") and pinned by nothing until now. Change the constant
    // and the card's number box shows one number while its own hint directly
    // below recommends another, with a green suite (audit C). The pin is a
    // literal on the constant, standing beside the string it has to agree
    // with — the shape `the copy names the daily limit the cap actually
    // enforces` below already uses, and the only shape available while the
    // catalogue is static and cannot interpolate.
    // Mutation: set REACTIVATION_DEFAULT_MONTHS to 6 → this reds, and the key
    // that has to change is named in the failure.
    expect(REACTIVATION_DEFAULT_MONTHS).toBe(9);
    expect(m["automations.reactivation.monthsHint"].toLowerCase()).toContain("nine is a good default");
  });

  it("the copy names the daily limit the cap actually enforces", () => {
    // The two keys say "five" in WORDS — "5 a day" reads like a receipt — so
    // the copy cannot be derived from the constant. The guard is therefore a
    // literal pin on the constant, standing beside the strings it has to agree
    // with. Mutation: change REACTIVATION_DAILY_CAP to 8 → this reds, and the
    // two keys that have to change are named in the failure.
    expect(REACTIVATION_DAILY_CAP).toBe(5);
    for (const key of ["automations.reactivation.limitNote", "automations.reactivation.body"] as const) {
      expect(m[key].toLowerCase(), key).toContain("five a day");
    }
  });
});
