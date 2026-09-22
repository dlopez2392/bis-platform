import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { appointmentConfirmLead, composeAppointmentConfirm } from "./appointment-confirm-copy";

const WHEN = "Wed, Sep 30, 12:30 PM CDT";

describe("the confirmation ask's copy", () => {
  it("names the brand, states the time, and asks for YES or NO", () => {
    const lead = appointmentConfirmLead("Rio Roofing", WHEN);
    expect(lead).toContain("Rio Roofing");
    expect(lead).toContain(WHEN);
    expect(lead).toContain("YES");
    expect(lead).toContain("NO");
  });

  it("CARRIES THE REASSURANCE, because there is no text back", () => {
    // Spec decision 6: a YES gets no reply. The customer's certainty is
    // bought here, in the ask, or not at all — so this clause is structural,
    // not a default an operator can delete. Mutation: remove "either way
    // we'll see it" from messages.ts → this test goes red BY NAME.
    expect(appointmentConfirmLead("Rio Roofing", WHEN).toLowerCase()).toContain("either way we'll see it");
    expect(appointmentConfirmLead("", WHEN).toLowerCase()).toContain("either way we'll see it");
  });

  it("drops the naming clause when there is no brand name, and never invents a noun", () => {
    // EXACT EQUALITY against the no-name template, not a bag of
    // `not.toContain`s. The first draft asserted
    // `not.toMatch(/\bus\b.*booked/i)`, which cannot fail: neither template
    // contains the word "us". This one reds the moment the blank-name
    // branch is deleted, because the with-name template then renders as
    // "Hi, it's    . You're booked for …".
    // Mutation: delete the `brandName.trim() ?` branch → red BY NAME.
    expect(appointmentConfirmLead("   ", WHEN))
      .toBe(m["automations.appointmentConfirm.leadNoName"].replace("{when}", WHEN));
    expect(appointmentConfirmLead("   ", WHEN)).not.toContain("undefined");
  });

  it("survives a company name containing a String.replace special", () => {
    // Function replacement, not a plain string: "$&" would otherwise be
    // re-interpreted. Mutation: drop the arrow function in the .replace call.
    expect(appointmentConfirmLead("A $& B", WHEN)).toContain("A $& B");
  });

  it("composes lead + the operator's optional closing line, and nothing when there is none", () => {
    expect(composeAppointmentConfirm("Rio Roofing", WHEN, "  Parking is out front.  "))
      .toBe(`${appointmentConfirmLead("Rio Roofing", WHEN)} Parking is out front.`);
    expect(composeAppointmentConfirm("Rio Roofing", WHEN, "   "))
      .toBe(appointmentConfirmLead("Rio Roofing", WHEN));
  });

  it("is ONE GSM-7 segment for a GSM-7 company name — the plan's em dash would have cost three", () => {
    // The house shape (review-request-copy.test.ts:36, no-show-nudge-copy.test.ts:40):
    // any character outside GSM7_BASE drops the WHOLE text to UCS-2 at 70
    // characters a segment. The plan prescribed
    // "…a different time — either way we'll see it", and measured against
    // segments.ts that lead is {ucs2, 149, 3} where the period is {gsm7,
    // 148, 1} — an extra billed segment on every confirmation this recipe
    // ever sends, against a repo rule already written down twice (opt-out.ts
    // and the instant reply's own copy comment: "No em dash anywhere").
    // Mutation: put the em dash back in `automations.appointmentConfirm.lead`
    // → this case reds BY NAME on the encoding.
    expect(segmentsFor(appointmentConfirmLead("Rio Roofing", WHEN)))
      .toMatchObject({ encoding: "gsm7", segments: 1 });
  });

  it("a company name with an accent is UCS-2, and the settings counter is what shows it", () => {
    // Not a defect and not ours to fix: the operator chose the name. The
    // guard is that the card's counter renders the REAL segmentsFor count
    // through this same composer, so the cost is visible before Save.
    expect(segmentsFor(appointmentConfirmLead("García Roofing", WHEN)).encoding).toBe("ucs2");
  });

  it("carries no internal milestone code and no template syntax", () => {
    const all = [appointmentConfirmLead("Rio Roofing", WHEN), composeAppointmentConfirm("Rio Roofing", WHEN, "x")];
    for (const s of all) {
      expect(s).not.toMatch(/\bM[0-9][a-z]?\b/);
      expect(s).not.toContain("{{");
    }
  });
});
