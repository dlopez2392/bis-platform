import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { withOptOut } from "@/lib/sms/opt-out";
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

  it("bills TWO GSM-7 segments for every company name, because the budget is already spent before the name — the plan's em dash would have cost three", () => {
    // MEASURES WHAT IS SENT, not what is composed. `sendAutomationSms`
    // appends `withOptOut` unconditionally (`send-sms.ts:82`), so the string
    // the customer receives — and the carrier bills — is 23 septets longer
    // than the lead. This case used to assert `{gsm7, 1}` over the
    // UNDISCLOSED lead, a string no customer ever receives, while the card's
    // own test asserted "171 characters · 2 message(s)" for the identical
    // fixture (`appointment-confirm-card.test.ts:49-56`). Two tests, one
    // recipe, opposite claims; only the card's was about the thing that goes
    // out (audit C).
    //
    // THE BUDGET, computed for THIS recipe and not borrowed from another:
    //   fixed lead   112  (the template with both placeholders removed)
    // + {when}        25  ("Wed, Sep 30, 12:30 PM CDT", formatWhen's shape)
    // + disclosure    23  (withOptOut, English)
    // = 160 + len(brandName)
    // GSM-7's first segment is 160 septets, so the budget is exhausted with
    // NOTHING left for the name: there is no non-blank company name for which
    // this recipe bills one segment. That is a product fact, recorded here
    // rather than asserted away — shortening
    // `automations.appointmentConfirm.lead` is danlo's call, not this fix's,
    // and decision 6's reassurance is the part that would have to go.
    //
    // The ENCODING half still does the work it was written for. Any character
    // outside GSM7_BASE drops the WHOLE text to UCS-2 at 70 characters a
    // segment: the plan prescribed "…a different time — either way we'll see
    // it", which measures {ucs2, 172, 3} disclosed where the period is
    // {gsm7, 171, 2} — an extra billed segment on every confirmation this
    // recipe ever sends, against a repo rule written down twice (opt-out.ts,
    // and the instant reply's copy comment: "No em dash anywhere").
    // Mutation: put the em dash back in `automations.appointmentConfirm.lead`
    // → this case reds BY NAME on the encoding.
    expect(segmentsFor(withOptOut(composeAppointmentConfirm("Rio Roofing", WHEN, ""))))
      .toMatchObject({ encoding: "gsm7", segments: 2 });
    // And the shortest real name money could buy is still two, so the number
    // above is not an artefact of one fixture.
    expect(segmentsFor(withOptOut(composeAppointmentConfirm("Ace", WHEN, ""))).segments).toBe(2);
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
