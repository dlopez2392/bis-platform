import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./system-prompt";
import type { VoicePromptInput } from "./session-config";

const base = {
  personaName: "Sofía", businessName: "Rio Roofing",
  greeting: "Thanks for calling Rio Roofing. How can I help?",
  facts: "- We repair and replace residential roofs in the RGV.",
  services: "Roof repair, full replacement, inspections",
  languages: "both" as const, bookingEnabled: true,
  timezone: "America/Chicago", slotDurationMinutes: 60,
  afterHours: "hours_then_message" as const, callerNumber: "+19562921696",
  meetingType: "in_person" as const,
};
const now = new Date("2027-06-01T15:00:00Z");

function baseInput(overrides: Partial<VoicePromptInput> = {}): VoicePromptInput {
  return { ...base, ...overrides };
}

describe("buildSystemPrompt", () => {
  it("carries identity disclosure, business fence, and the hard limits", () => {
    const p = buildSystemPrompt(base, now);
    expect(p).toContain("Never claim to be human");
    expect(p).toContain("Rio Roofing");
    expect(p).toContain(base.facts);
    expect(p).toContain("Never invent facts");
    expect(p).toContain("Never quote a price");
  });
  it("booking disabled removes the booking sections and tool instructions", () => {
    const p = buildSystemPrompt({ ...base, bookingEnabled: false }, now);
    expect(p).not.toContain("book_appointment");
    expect(p).not.toContain("BOOKING");
    expect(p).toContain("take_message");
  });
  it("languages=en drops the bilingual rule; both keeps it", () => {
    expect(buildSystemPrompt({ ...base, languages: "en" }, now)).not.toContain("Spanish");
    expect(buildSystemPrompt(base, now)).toContain("Spanish");
  });
  it("anchors the current date-time in the account timezone with pinned locale", () => {
    const p = buildSystemPrompt(base, now);
    expect(p).toContain("2027"); // rendered date present
    expect(p).toContain("phone number");
  });
  it("uses the persona name the client chose", () => {
    const p = buildSystemPrompt({ ...base, personaName: "Alex" }, now);
    expect(p).toContain("Alex");
    expect(p).not.toContain("Sofía");
  });
  it("email rule demands per-character read-back and disambiguates spoken symbol words", () => {
    const p = buildSystemPrompt(baseInput({ bookingEnabled: true }), now);
    expect(p).toMatch(/character by character/i);
    expect(p).toMatch(/'plus'/);
    expect(p).toMatch(/nonexistent address/);
  });
  it("the email-confirmation ask is its own line-initial step, not buried in the mechanics rule", () => {
    // Regression: 2026-08-28's first real call skipped the email offer. The
    // ask had been folded mid-paragraph into the EMAIL ADDRESSES read-back
    // rule, and the model stopped treating it as a step. It must LEAD a
    // bullet of its own.
    const p = buildSystemPrompt(baseInput({ bookingEnabled: true }), now);
    expect(p).toMatch(/^- BEFORE you book: ask once whether they would like an email confirmation/m);
  });
  it("orders the model to speak tool-provided local times and never do its own conversion", () => {
    // Regression: 2026-08-30 live call. The model rescheduled to the asked-for
    // 4 PM, re-read the result's raw ISO with the wrong UTC offset, decided it
    // had booked the wrong slot, and silently moved the booking an hour
    // forward. Tool results now carry a `local`/`startsAtLocal` rendering; the
    // prompt must forbid manual conversion.
    const p = buildSystemPrompt(baseInput({ bookingEnabled: true }), now);
    expect(p).toMatch(/NEVER convert an ISO timestamp yourself/);
    expect(p).toMatch(/local/);
  });
  it("failed bookings must capture_lead before take_message", () => {
    const p = buildSystemPrompt(baseInput({ bookingEnabled: true }), now);
    expect(p).toMatch(/FIRST call capture_lead/);
    expect(p).toMatch(/Never end a call knowing the caller's name/);
  });
  it("booking-disabled prompt carries neither booking rule", () => {
    const p = buildSystemPrompt(baseInput({ bookingEnabled: false }), now);
    expect(p).not.toMatch(/FIRST call capture_lead/);
  });
  it("video meetingType adds the video line inside the booking-enabled branch", () => {
    const p = buildSystemPrompt(baseInput({ meetingType: "video" }), now);
    expect(p).toMatch(/VIDEO CALL/);
    expect(p).toMatch(/Never read a web link aloud/);
  });
  it("video prompts carry NO phone-only decline script anywhere — the generic bullets go conditional", () => {
    // The 2026-08-30 refusal call was not improvisation after all: the
    // GENERIC booking bullet scripts "book with the phone number alone, and
    // say the business will confirm by phone" — Sofía followed it verbatim
    // while the video bullet said the opposite. Contradictory instructions
    // lose to the more specific script; on video calendars the phone-only
    // path must not be in the prompt at all.
    const video = buildSystemPrompt(baseInput({ meetingType: "video" }), now);
    expect(video).not.toContain("book with the phone number alone");
    expect(video).not.toContain("say the business will confirm by phone");
    expect(video).not.toContain("pass emailDeclined: true");
    const plain = buildSystemPrompt(baseInput({ meetingType: "in_person" }), now);
    expect(plain).toContain("book with the phone number alone");
    expect(plain).toContain("pass emailDeclined: true");
  });
  it("video line forbids the phone-only improvisation, by name", () => {
    // Regression: 2026-08-30 live call. The caller said "No" to email and
    // Sofía answered "We can book the appointment using just your phone
    // number, and the business will confirm by phone" — a policy she
    // invented on the spot. The old line said email-is-required and she
    // recited it moments earlier; what it lacked was the explicit negative
    // naming the exact improvisation, and the instruction to STOP collecting
    // details.
    const p = buildSystemPrompt(baseInput({ meetingType: "video" }), now);
    expect(p).toMatch(/no phone-only option/i);
    expect(p).toMatch(/NEVER offer to book with just a phone number/);
    expect(p).toMatch(/stop collecting booking details/i);
  });
  it("non-video meetingType omits the video line", () => {
    const p = buildSystemPrompt(baseInput({ meetingType: "in_person" }), now);
    expect(p).not.toMatch(/VIDEO CALL/);
    const pPhone = buildSystemPrompt(baseInput({ meetingType: "phone" }), now);
    expect(pPhone).not.toMatch(/VIDEO CALL/);
  });
  it("booking-disabled branch never carries the video line even when meetingType is video", () => {
    const p = buildSystemPrompt(baseInput({ bookingEnabled: false, meetingType: "video" }), now);
    expect(p).not.toMatch(/VIDEO CALL/);
  });

  // Sofía may only offer what this account can actually deliver. A transfer
  // target either exists (`handoffAvailable`) or it does not; when it does
  // not, the prompt must be the one shipping today, unchanged — a
  // present-tense promise the product cannot keep is the defect this whole
  // feature is fenced against.
  it("offers to put the caller through when a transfer target is available", () => {
    const p = buildSystemPrompt(baseInput({ handoffAvailable: true }), now);
    expect(p).toContain("transfer_to_human");
    expect(p).toMatch(/put them through/i);
    // The take-a-message fallback clause is REPLACED, not doubled up: telling
    // her to offer a message AND a transfer in the same breath asks the
    // caller the same question twice.
    expect(p).not.toContain("offer to take a message if they would rather talk to a person");
  });
  it("keeps today's take-a-message copy when no target is configured", () => {
    const p = buildSystemPrompt(baseInput({ handoffAvailable: false }), now);
    expect(p).not.toContain("transfer_to_human");
    expect(p).toContain("offer to take a message");
    expect(p).toContain("offer to take a message if they would rather talk to a person");
  });
  it("an omitted handoffAvailable renders byte-for-byte the no-transfer prompt — the default fails closed", () => {
    // `handoffAvailable` is optional (session-config.ts:25) and the web demo
    // never sets it: omitted must mean exactly what false means, to the byte,
    // or "no transfer configured" and "no phone leg at all" drift into two
    // different Sofías.
    expect(buildSystemPrompt(baseInput({ handoffAvailable: false }), now))
      .toBe(buildSystemPrompt(base, now));
    expect(buildSystemPrompt(base, now)).not.toContain("transfer_to_human");
  });
});

// Booking tools are bound to the verified caller (tools/registry.ts). The
// prompt says the same thing the tools enforce, so the model does not promise
// a lookup the tool will refuse. Pinned on phrases that appear ONLY in the new
// lines — "number they are calling from" alone is also in the read-back rule.
describe("buildSystemPrompt — appointments are the caller's own", () => {
  const NEVER_ANOTHER = "for any number other than the one they are calling from";
  const WITHHELD = "you cannot look up, change or cancel an existing appointment on this call";

  it("find_my_booking takes no number and is called first; reschedule/cancel only for what it returned or what was booked on this call", () => {
    const p = buildSystemPrompt(base, now);
    expect(p).toContain("- find_my_booking() — call it FIRST");
    expect(p).not.toContain("find_my_booking(phone)");
    expect(p).toMatch(/only for the booking find_my_booking returned on this call, or one you booked on this call/);
  });

  it("a refused lookup or change ends in the offer this account can keep — a transfer, or a message", () => {
    const withTransfer = buildSystemPrompt(baseInput({ handoffAvailable: true }), now);
    expect(withTransfer).toMatch(/If either refuses, apologize and offer to put them through to someone on the team/);
    const without = buildSystemPrompt(base, now);
    expect(without).toMatch(/If either refuses, apologize and offer to take a message/);
  });

  it("the never-another-number rule is on a phone booking prompt", () => {
    const p = buildSystemPrompt(base, now);
    expect(p).toContain(NEVER_ANOTHER);
    expect(p).toMatch(/call back from that phone/);
  });

  it("the never-another-number rule is absent from the web prompt and from a no-booking phone prompt", () => {
    expect(buildSystemPrompt(baseInput({ medium: "web" }), now)).not.toContain(NEVER_ANOTHER);
    expect(buildSystemPrompt(baseInput({ medium: "web", bookingEnabled: false, callerNumber: null }), now))
      .not.toContain(NEVER_ANOTHER);
    expect(buildSystemPrompt(baseInput({ bookingEnabled: false }), now)).not.toContain(NEVER_ANOTHER);
  });

  it("the withheld-number line gains the no-lookup sentence only when the number is withheld AND booking is on", () => {
    const withheld = buildSystemPrompt(baseInput({ callerNumber: null }), now);
    expect(withheld).toContain("The caller's number is not visible.");
    expect(withheld).toContain(WITHHELD);
    expect(buildSystemPrompt(base, now)).not.toContain(WITHHELD);
    expect(buildSystemPrompt(baseInput({ callerNumber: null, bookingEnabled: false }), now)).not.toContain(WITHHELD);
    expect(buildSystemPrompt(baseInput({ callerNumber: null, medium: "web" }), now)).not.toContain(WITHHELD);
  });

  it("the no-booking withheld line is unchanged, to the byte", () => {
    const p = buildSystemPrompt(baseInput({ callerNumber: null, bookingEnabled: false }), now);
    expect(p).toContain("\nThe caller's number is not visible. Ask for a callback number when you need one.\n");
  });
});

describe("buildSystemPrompt medium", () => {
  // THE PROPERTY THAT MATTERS MOST: every existing caller passes no `medium`
  // at all, and their prompt must not move by one byte. A prompt change is a
  // behaviour change on a live phone line.
  it("is byte-identical when no medium is given and when medium is phone", () => {
    expect(buildSystemPrompt(baseInput({ medium: "phone" }), now))
      .toBe(buildSystemPrompt(base, now));
    // The Spanish-only LANGUAGE branch is the one line item 6 (Branch 2
    // hardening) touches — its own byte-identity proof, not covered by the
    // bilingual case above, since "both" and "es" take different branches.
    expect(buildSystemPrompt(baseInput({ languages: "es", medium: "phone" }), now))
      .toBe(buildSystemPrompt(baseInput({ languages: "es" }), now));
  });

  it("says phone receptionist and phone call by default", () => {
    const p = buildSystemPrompt(base, now);
    expect(p).toContain("the phone receptionist for Rio Roofing");
    expect(p).toContain("This is a phone call");
  });

  it("says neither of those on the web", () => {
    const p = buildSystemPrompt(baseInput({ medium: "web" }), now);
    expect(p).not.toContain("phone receptionist");
    expect(p).not.toContain("This is a phone call");
    expect(p).toContain("the assistant on the website for Rio Roofing");
    expect(p).toContain("This is a text chat");
  });

  it("keeps the tenant's own facts, limits and tools on both mediums", () => {
    for (const medium of ["phone", "web"] as const) {
      const p = buildSystemPrompt(baseInput({ medium }), now);
      expect(p).toContain(base.facts);
      expect(p).toContain("Never quote a price");
      expect(p).toContain("capture_lead");
    }
  });

  // IMPORTANT 2 (review of commit 129b43f): the old web demo appended a
  // notice AFTER a base prompt that still told the model to take a message,
  // log a transcript, and ask for a callback number — tools that do not
  // exist on the web. `WEB_TOOL_NOTICE` recreated exactly that contradiction
  // one layer up. The fix is source-conditional, not an appendix: every
  // place the phone prompt would say "take a message" resolves to
  // capture_lead on the web instead.
  describe("the web prompt never promises a tool it was not given", () => {
    it("names capture_lead as the ONLY tool, and never offers take_message or log_transcript as things it can call", () => {
      const p = buildSystemPrompt(baseInput({ medium: "web", bookingEnabled: false }), now);
      expect(p).toContain("capture_lead is the ONLY tool you have here");
      // The notice is ALLOWED to name take_message and log_transcript to say
      // they do not exist — what must never appear is the PHONE bullet that
      // offers them as callable tools.
      // MUTATION: leave the phone TOOLS bullets unconditional — this FAILS,
      // and a web visitor is told Sofía can take a message that nothing
      // records.
      expect(p).not.toContain("take_message(body, callbackNumber)");
      expect(p).not.toContain("log_transcript is called automatically");
    });

    it("never offers to take a message or asks for a callback number, anywhere in the prompt", () => {
      const p = buildSystemPrompt(baseInput({
        medium: "web", bookingEnabled: false, afterHours: "message_only", callerNumber: null,
      }), now);
      // MUTATION: revert the IDENTITY line's `wouldRatherTalkToAPerson` to
      // its old unconditional ternary — this FAILS, and the AFTER HOURS,
      // HARD LIMITS and no-phone-booking lines below still contain the
      // phrase too, so any one of them left unguarded also turns this red.
      expect(p).not.toMatch(/take a message/i);
      expect(p).not.toMatch(/callback number/i);
      // IMPORTANT A (second-round review of 108b822): the phone capture_lead
      // bullet names a `fields` wrapper and a `businessName` capture that the
      // web tool (`CAPTURE_LEAD_TOOL`, lib/concierge/prompt.ts) does not have
      // — flat properties, no wrapper, no businessName. A model following the
      // phone bullet emits `{"fields":{...}}`, `parseCaptureLead` finds no
      // top-level `fullName`, and the lead is silently dropped.
      // MUTATION: leave the capture_lead TOOLS bullet unconditional — this
      // FAILS, and the web prompt still tells the model to wrap its call in
      // a `fields` object and capture a `businessName` it was never given a
      // slot for.
      expect(p).not.toContain("businessName");
      expect(p).not.toContain("capture_lead(fields)");
    });

    it("describes capture_lead's real flat web shape, not the phone's fields wrapper", () => {
      // IMPORTANT A: the web tool's real schema (CAPTURE_LEAD_TOOL) is FLAT —
      // fullName/email/phone/need at the top level, additionalProperties:
      // false, no `fields` wrapper, no `businessName`. The web prompt must
      // describe THAT shape, not the phone tool's.
      const web = buildSystemPrompt(baseInput({ medium: "web", bookingEnabled: false }), now);
      expect(web).toContain("capture_lead(fullName, email, phone, need)");
      expect(web).not.toContain("capture_lead(fields)");
      // The phone bullet is BYTE-UNCHANGED — this is the live line.
      const phone = buildSystemPrompt(baseInput({ bookingEnabled: false }), now);
      expect(phone).toContain(
        "- capture_lead(fields) — record who the caller is and what they need. "
        + "Required fields: fullName, need. Also capture when offered: email, businessName.",
      );
    });

    it("says visitor, not caller, in the IDENTITY line on the web; the phone line is unchanged", () => {
      const web = buildSystemPrompt(baseInput({ medium: "web" }), now);
      expect(web).toContain("get straight to what the visitor needs");
      expect(web).toContain("If a visitor asks directly whether");
      expect(web).not.toContain("what the caller needs");
      expect(web).not.toContain("If a caller asks directly");
      const phone = buildSystemPrompt(base, now);
      expect(phone).toContain("get straight to what the caller needs");
      expect(phone).toContain("If a caller asks directly whether");
    });

    it("says visitor, not caller, in the bilingual LANGUAGE line on the web; the phone line is unchanged", () => {
      const web = buildSystemPrompt(baseInput({ medium: "web" }), now);
      expect(web).toContain("the visitor uses");
      expect(web).not.toContain("the caller uses");
      const phone = buildSystemPrompt(base, now);
      expect(phone).toContain("the caller uses");
    });

    // Item 6 (Branch 2 hardening): the Spanish-only LANGUAGE branch still
    // said "caller" on the web — an es-only tenant is a real configuration
    // in this market, and it never went through the "both" branch above.
    it("says visitor, not caller, in the Spanish-only LANGUAGE line on the web; the phone line is unchanged", () => {
      // callerNumber: null — the real value the concierge route always
      // passes (route.ts's own buildSystemPrompt call), since text has no
      // caller ID. `base.callerNumber` is a PHONE fixture value and would
      // otherwise leak an unrelated, pre-existing "The caller is calling
      // from…" line into this assertion — out of this item's scope, which is
      // the LANGUAGE branch's own word only.
      const web = buildSystemPrompt(baseInput({ languages: "es", medium: "web", callerNumber: null }), now);
      expect(web).toContain("LANGUAGE — Speak Spanish. If a visitor uses English");
      // MUTATION: revert `${audienceWord}` to the literal "caller" — this
      // FAILS.
      expect(web).not.toContain("If a caller uses English");
      const phone = buildSystemPrompt(baseInput({ languages: "es" }), now);
      expect(phone).toContain("If a caller uses English");
    });

    it("resolves 'would rather talk to a person' to capture_lead in the IDENTITY line", () => {
      const p = buildSystemPrompt(baseInput({ medium: "web", bookingEnabled: false }), now);
      expect(p).toContain(
        "use capture_lead to get their name and a way to reach them, and say the "
        + "team will follow up if they would rather talk to a person",
      );
    });

    it("gives the no-phone-booking fallback web wording, and the phone gets its own unchanged", () => {
      const web = buildSystemPrompt(baseInput({ medium: "web", bookingEnabled: false }), now);
      expect(web).toContain("This business does not take bookings through this chat");
      const phone = buildSystemPrompt(baseInput({ bookingEnabled: false }), now);
      // The phone branch is BYTE-UNCHANGED — this is the live line, and a
      // medium-conditional edit must not move it.
      expect(phone).toContain(
        "This business does not take bookings by phone. If a caller asks to "
        + "schedule something, take a message with their details and say "
        + "someone will call them back to arrange it.",
      );
    });

    it("gives the AFTER HOURS notice web wording, and the phone gets its own unchanged", () => {
      const web = buildSystemPrompt(baseInput({
        medium: "web", bookingEnabled: false, afterHours: "message_only",
      }), now);
      expect(web).toContain("AFTER HOURS");
      expect(web).not.toMatch(/take a message/i);
      const phone = buildSystemPrompt(baseInput({ afterHours: "message_only" }), now);
      expect(phone).toContain(
        "AFTER HOURS — If the business is closed right now, say so briefly "
        + "and take a message; do not attempt anything else.",
      );
    });
  });
});
