import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { buildSystemPrompt } from "./system-prompt";
import type { VoicePromptInput } from "./session-config";
import { TRADE_MODULES } from "./modules";
import { buildRealtimeSessionConfig } from "./session-config";
import type { OpenHours } from "../booking/slots";
import type { RenderedService } from "./knowledge/payload";

const base = {
  personaName: "Sofía", businessName: "Rio Roofing",
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

// Booking tools are bound to the caller ID (tools/registry.ts). The
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
    // The bubble renders raw text; a model left to its defaults answers in
    // markdown and the asterisks land on a client's website.
    expect(p).toContain("Write plain text only");
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

    // Owner decision B (2026-10-09): the always-take-a-message wording is
    // PHONE ONLY. The website chat keeps the conditional line it always had.
    it("keeps the website chat on the OLD conditional after-hours line under Always take a message (mutation: no phone gate → FAILS)", () => {
      const web = buildSystemPrompt(baseInput({
        medium: "web", bookingEnabled: false, afterHours: "message_only",
      }), now);
      expect(web).toContain(
        "AFTER HOURS — If the business is closed right now, say so briefly, and use capture_lead to get their name and a way to reach them so the team can follow up.",
      );
      expect(web).not.toContain("MESSAGES ONLY");
      expect(web).not.toMatch(/take a message/i);
    });

    it("keeps the browser voice demo on the OLD conditional phone line under Always take a message (mutation: no phone gate → FAILS)", () => {
      const demo = buildSystemPrompt(baseInput({
        medium: "web_voice", bookingEnabled: false, afterHours: "message_only", callerNumber: null,
      }), now);
      expect(demo).toContain(
        "AFTER HOURS — If the business is closed right now, say so briefly and take a message; do not attempt anything else.",
      );
      expect(demo).not.toContain("MESSAGES ONLY");
    });
  });
});

// D-040: the Voice page's "Always take a message" told Sofía to take a
// message only "if the business is closed right now" — during open hours she
// went on booking, which is the other option's behaviour, not this one's.
describe("buildSystemPrompt — Always take a message (message_only), on the phone", () => {
  it("tells her never to book a new appointment and to take a message for anything new, open or closed", () => {
    const p = buildSystemPrompt(baseInput({ afterHours: "message_only" }), now);
    expect(p).toContain("MESSAGES ONLY — Whatever the time, open or closed, never book a new appointment on this line. For anything new, take a message");
    expect(p).not.toContain("closed right now");
  });

  it("offers no NEW booking, even when the profile allows booking", () => {
    const p = buildSystemPrompt(baseInput({ afterHours: "message_only", bookingEnabled: true }), now);
    expect(p).not.toContain("book_appointment(");
    expect(p).not.toContain("BOOKING — Appointments are");
  });

  // Owner decision A (2026-10-09): it replaces BOOKING only. A caller with an
  // appointment can still find, move or cancel it.
  it("keeps an existing appointment manageable: find, move, cancel, and the times to move it to (mutation: drop the manage tools → FAILS)", () => {
    const p = buildSystemPrompt(baseInput({ afterHours: "message_only", bookingEnabled: true }), now);
    expect(p).toContain("- find_my_booking() — call it FIRST");
    expect(p).toContain("- reschedule_appointment(bookingId, startsAt) / cancel_appointment(bookingId)");
    expect(p).toContain("- check_availability(date)");
    expect(p).toContain("- TIMES — tool results give every time twice");
    expect(p).toContain("If they already have an appointment, you can still look it up, move it or cancel it.");
  });

  it("with booking off on the profile, there is nothing to manage and the line does not pretend there is", () => {
    const p = buildSystemPrompt(baseInput({ afterHours: "message_only", bookingEnabled: false }), now);
    expect(p).not.toContain("find_my_booking()");
    expect(p).not.toContain("already have an appointment");
  });

  // Owner decision A: an urgent caller can still be put through when the
  // account has a transfer number.
  it("carves the transfer out when there is someone to transfer to, and only then (mutation: no carve-out → FAILS)", () => {
    const withHandoff = buildSystemPrompt(baseInput({ afterHours: "message_only", handoffAvailable: true }), now);
    expect(withHandoff).toContain("If they ask for a person, or it cannot wait, you can still put them through to someone on the team.");
    const without = buildSystemPrompt(baseInput({ afterHours: "message_only", handoffAvailable: false }), now);
    expect(without).not.toContain("put them through");
  });

  it("leaves Follow-business-hours exactly as it was: booking on, no messages-only line", () => {
    const p = buildSystemPrompt(baseInput({ afterHours: "hours_then_message", bookingEnabled: true }), now);
    expect(p).toContain("book_appointment(");
    expect(p).not.toContain("MESSAGES ONLY");
  });
});

// Re-review minor: with no caller ID, find_my_booking refuses (tools are bound
// to the caller ID), so a "message only" call must not promise a look-up.
describe("buildSystemPrompt — Always take a message with a hidden caller ID", () => {
  const WARN = "The caller's number is not visible. Ask for a callback number when you need one. Because of that, you cannot look up, change or cancel an existing appointment on this call";

  it("warns that existing appointments cannot be reached, without the book-during-this-call clause (mutation: warn only when new booking is allowed → FAILS)", () => {
    const p = buildSystemPrompt(baseInput({ afterHours: "message_only", bookingEnabled: true, callerNumber: null }), now);
    expect(p).toContain(`${WARN} — if they ask, offer to take a message instead.`);
    expect(p).not.toContain("one you book during this call");
  });

  it("does not promise to look up, move or cancel an appointment (mutation: keep the promise → FAILS)", () => {
    const p = buildSystemPrompt(baseInput({ afterHours: "message_only", bookingEnabled: true, callerNumber: null }), now);
    expect(p).not.toContain("you can still look it up, move it or cancel it");
  });

  it("with a caller ID the promise stands, and Follow business hours keeps its own line unchanged", () => {
    const shown = buildSystemPrompt(baseInput({ afterHours: "message_only", bookingEnabled: true }), now);
    expect(shown).toContain("If they already have an appointment, you can still look it up, move it or cancel it.");
    const full = buildSystemPrompt(baseInput({ afterHours: "hours_then_message", bookingEnabled: true, callerNumber: null }), now);
    expect(full).toContain(`${WARN} (one you book during this call can still be changed) — if they ask, offer to take a message instead.`);
  });
});

describe("buildSystemPrompt — the IDENTITY line follows what was said (S-47a)", () => {
  // The whole pre-S-47a line (system-prompt.ts:72) for the base input, typed out: Rio Roofing, a caller,
  // no transfer number. A prefix would let a change in the line's tail pass.
  const OLD =
    "IDENTITY — Do not volunteer that you are automated and do not introduce yourself by name unless asked. Just answer as Rio Roofing and get straight to what the caller needs. If a caller asks directly whether they are speaking with a person, a human, a bot, a robot, or an AI, answer honestly and briefly that you are an automated assistant, then offer to take a message if they would rather talk to a person. Never claim to be human.";
  const PHONE_DISCLOSED =
    "IDENTITY — You have already told the caller that you are Sofía, an AI assistant. If they ask whether they are speaking with a person, a human, a bot, a robot, or an AI, confirm it plainly: you are an AI assistant. Then offer to take a message if they would rather talk to a person. Never claim to be human. Answer as Rio Roofing and get straight to what the caller needs.";
  const WEB_DISCLOSED =
    "IDENTITY — You have already told the visitor that you are Sofía, an AI assistant. If they ask whether they are speaking with a person, a human, a bot, a robot, or an AI, confirm it plainly: you are an AI assistant. Then use capture_lead to get their name and a way to reach them, and say the team will follow up if they would rather talk to a person. Never claim to be human. Answer as Rio Roofing and get straight to what the visitor needs.";

  it("disclosed false (and absent) is byte-identical to before (mutation: always use the disclosed line → FAILS)", () => {
    expect(buildSystemPrompt(baseInput({ disclosed: false }), now)).toBe(buildSystemPrompt(base, now));
    expect(buildSystemPrompt(base, now).split("\n").find((l) => l.startsWith("IDENTITY"))).toBe(OLD);
  });
  it("disclosed with a blank persona falls back to Sofía, as the greeting does (mutation: use input.personaName raw → FAILS)", () => {
    expect(buildSystemPrompt(baseInput({ disclosed: true, personaName: "  " }), now))
      .toContain("IDENTITY — You have already told the caller that you are Sofía, an AI assistant.");
  });
  it("disclosed true on the phone swaps the line, and only that line", () => {
    const p = buildSystemPrompt(baseInput({ disclosed: true }), now);
    expect(p).toContain(PHONE_DISCLOSED);
    expect(p).not.toContain(OLD);
    expect(p.replace(PHONE_DISCLOSED, "X")).toBe(buildSystemPrompt(base, now).replace(/IDENTITY — [^\n]*/, "X"));
  });
  it("disclosed true with a transfer number offers the transfer", () => {
    expect(buildSystemPrompt(baseInput({ disclosed: true, handoffAvailable: true }), now))
      .toContain("Then offer to put them through to someone on the team if they would rather talk to a person.");
  });
  it("disclosed true on the web says visitor and the capture_lead follow-up", () => {
    expect(buildSystemPrompt(baseInput({ disclosed: true, medium: "web" }), now)).toContain(WEB_DISCLOSED);
  });
  it("'Never claim to be human.' is on every call either way (mutation: drop it from the disclosed line → FAILS)", () => {
    for (const disclosed of [false, true]) {
      for (const medium of ["phone", "web"] as const) {
        const identity = buildSystemPrompt(baseInput({ disclosed, medium }), now).split("\n").find((l) => l.startsWith("IDENTITY"));
        expect(identity, `${disclosed}/${medium}`).toContain("Never claim to be human.");
      }
    }
  });
});

// S-47b: every combination this file's existing inputs can take. A literal list, so the loop's reach is
// asserted (1728 prompts) rather than assumed.
function everyExistingInput(): VoicePromptInput[] {
  const out: VoicePromptInput[] = [];
  for (const medium of [undefined, "phone", "web", "web_voice"] as const)
    for (const handoffAvailable of [undefined, false, true] as const)
      for (const languages of ["en", "es", "both"] as const)
        for (const bookingEnabled of [true, false])
          for (const afterHours of ["hours_then_message", "message_only"] as const)
            for (const meetingType of ["in_person", "phone", "video"] as const)
              for (const callerNumber of ["+19562921696", null])
                for (const disclosed of [false, true])
                  out.push({
                    ...base, languages, bookingEnabled, afterHours, meetingType, callerNumber, disclosed,
                    ...(medium === undefined ? {} : { medium }),
                    ...(handoffAvailable === undefined ? {} : { handoffAvailable }),
                  });
  return out;
}
function digestOf(prompts: string[]): string {
  const h = createHash("sha256");
  for (const p of prompts) h.update(`${p}\u0000`);
  return h.digest("hex");
}
/** sha256 over all 1728 prompts as they were at 6c123483, BEFORE S-47b touched system-prompt.ts. */
const PRE_S47B_DIGEST = "222fe52521c0ad6aa22744a03dfb182c11ad06185e1cce8a54cdaa7d027300ba";

describe("buildSystemPrompt — no trade module is byte-identical to before S-47b", () => {
  it("covers 1728 combinations (guards the digest from an empty loop)", () => {
    expect(everyExistingInput().length).toBe(1728);
  });
  it("with no tradeModule key, every combination is byte-identical to 6c123483 (mutation: push an unconditional \"\" before TOOLS -> FAILS)", () => {
    expect(digestOf(everyExistingInput().map((i) => buildSystemPrompt(i, now)))).toBe(PRE_S47B_DIGEST);
  });
});

describe("buildSystemPrompt — the trade module block (S-47b)", () => {
  const ANCHOR = "- Never give legal, medical, or compliance advice.";
  const INS = "TRADE RULES — INSURANCE (PROPERTY AND CASUALTY):";
  const EVT = "TRADE RULES — EVENTS AND VENUES:";

  it("tradeModule: null is byte-identical to before, across all 1728 combinations (mutation: treat null as a module -> FAILS)", () => {
    expect(digestOf(everyExistingInput().map((i) => buildSystemPrompt({ ...i, tradeModule: null }, now)))).toBe(PRE_S47B_DIGEST);
  });

  it("sits right after the HARD LIMITS lines: the anchor, a blank line, the heading; and removing it gives back the prompt without it (48 combinations)", () => {
    let seen = 0;
    for (const id of ["insurance_pc", "events"] as const)
      for (const medium of ["phone", "web", "web_voice"] as const)
        for (const handoffAvailable of [false, true])
          for (const bookingEnabled of [true, false])
            for (const afterHours of ["hours_then_message", "message_only"] as const) {
              const input = baseInput({ medium, handoffAvailable, bookingEnabled, afterHours });
              const without = buildSystemPrompt(input, now);
              const withIt = buildSystemPrompt({ ...input, tradeModule: id }, now);
              const lines = withIt.split("\n");
              const at = lines.indexOf(ANCHOR);
              expect(lines[at + 1]).toBe("");
              expect(lines[at + 2]).toBe(TRADE_MODULES[id].heading);
              const blockLines = lines.slice(at + 3, lines.indexOf("", at + 3));
              expect(withIt.replace(`\n\n${TRADE_MODULES[id].heading}\n${blockLines.join("\n")}`, "")).toBe(without);
              seen += 1;
            }
    expect(seen).toBe(48);
  });

  it("each module's heading appears only for that module (mutation: always use insurance -> FAILS)", () => {
    const ins = buildSystemPrompt(baseInput({ tradeModule: "insurance_pc" }), now);
    const evt = buildSystemPrompt(baseInput({ tradeModule: "events" }), now);
    expect(ins.split(INS).length - 1).toBe(1);
    expect(ins).not.toContain(EVT);
    expect(evt.split(EVT).length - 1).toBe(1);
    expect(evt).not.toContain(INS);
  });

  it("the web prompt's block names capture_lead and no transfer, even with handoffAvailable true (mutation: medium hard-coded 'phone' -> FAILS)", () => {
    const web = buildSystemPrompt(baseInput({ medium: "web", handoffAvailable: true, tradeModule: "events" }), now);
    expect(web).toContain(` Then, once you know whether anyone is hurt or in danger, use capture_lead with a need that starts with "Urgent:" as soon as you have their name and a phone number or email, and tell them the team will follow up as soon as they can. Never promise a time.`);
    // Bounded to the block: system-prompt.ts:183-187 lists transfer_to_human in TOOLS whenever handoffAvailable
    // is set, on any medium, and that line is NOT this PR's to change. Only the block must not name it.
    const blockText = web.slice(web.indexOf(EVT), web.indexOf("\n\nTOOLS"));
    expect(blockText).toContain(EVT);
    expect(blockText).not.toContain("transfer_to_human");
  });

  it("the phone block offers to connect only when handoffAvailable (mutation: handoffAvailable: true in the ctx -> FAILS)", () => {
    const offer = ` Then, once you know whether anyone is hurt or in danger, offer to connect them: "Would you like me to connect you with someone at the agency now?"`;
    expect(buildSystemPrompt(baseInput({ handoffAvailable: true, tradeModule: "insurance_pc" }), now)).toContain(offer);
    expect(buildSystemPrompt(baseInput({ handoffAvailable: false, tradeModule: "insurance_pc" }), now)).not.toContain(offer);
  });

  it("canBook follows the booking MODE, not the checkbox: Always take a message drops the tour line (mutation: canBook: input.bookingEnabled -> FAILS)", () => {
    const tour = "- If they would like to see the venue, you may book a tour with book_appointment. Call check_availability for the exact date they named (work it out from today's date above, and check that its weekday is the one they said), and offer only the times it returns. Never say a day has no tours or no times without checking that day. When they pick a time, confirm it back once, then book it. A booked tour is only a visit and holds no date or room for their event, so say so if they ask.";
    const noVisit = "- You cannot book a visit or a tour here. Never offer, invite or ask for a day or a time to visit. If they want to see the venue, note it with the rest of what you record, and tell them the team will set up a visit with them.";
    const full = buildSystemPrompt(baseInput({ bookingEnabled: true, afterHours: "hours_then_message", tradeModule: "events" }), now);
    const messageOnly = buildSystemPrompt(baseInput({ bookingEnabled: true, afterHours: "message_only", tradeModule: "events" }), now);
    expect(full).toContain(tour);
    expect(full).not.toContain(noVisit);
    expect(messageOnly).not.toContain(tour);
    expect(messageOnly).toContain(noVisit);
  });

  it("the profile's languages reach the block: only a bilingual profile is told to switch (fix round m-a; mutation: languages hard-coded 'both' in the ctx -> FAILS)", () => {
    const sw = "and switch when they switch";
    expect(buildSystemPrompt(baseInput({ languages: "both", tradeModule: "events" }), now)).toContain(sw);
    for (const languages of ["en", "es"] as const) {
      const p = buildSystemPrompt(baseInput({ languages, tradeModule: "events" }), now);
      expect(p).toContain("- The Spanish lines below are only for when they are speaking Spanish; when they are speaking English, say the English line.");
      expect(p).not.toContain(sw);
    }
  });

  it("the browser voice demo gets the demo variant (SD1)", () => {
    expect(buildSystemPrompt(baseInput({ medium: "web_voice", tradeModule: "events" }), now))
      .toContain(" Then tell them you cannot pass a message on from here, and point them to the next step the website notice below gives.");
  });

  it("the generic legal/medical line stays, and the business name reaches the block", () => {
    const p = buildSystemPrompt(baseInput({ tradeModule: "insurance_pc" }), now);
    expect(p).toContain(ANCHOR);
    expect(p).toContain("a licensed agent at Rio Roofing.");
  });
});

// S-47c (spec section 7): every existing combination × trade module (none, insurance_pc, events). A literal list,
// so the loop's reach is asserted (5184 prompts) rather than assumed. Recorded on the UNMODIFIED system-prompt.ts,
// which at this plan's base is main 044b1ab2's (Task 0's base check).
function everyS47cBaseInput(): VoicePromptInput[] {
  const out: VoicePromptInput[] = [];
  for (const i of everyExistingInput())
    for (const tradeModule of [undefined, "insurance_pc", "events"] as const)
      out.push(tradeModule === undefined ? i : { ...i, tradeModule });
  return out;
}
/** sha256 over all 5184 prompts as they were at 044b1ab2, BEFORE S-47c touched system-prompt.ts. */
const PRE_S47C_DIGEST = "f41acd22cb3282c0c11b9b925d04e53b372e6b3a1fe90f6ee6ed3567743fbfd1";

describe("buildSystemPrompt — no hours and no list is byte-identical to before S-47c (C3)", () => {
  it("covers 5184 combinations (guards the digest from an empty loop)", () => {
    expect(everyS47cBaseInput().length).toBe(5184);
  });
  it("with neither new key, every combination is byte-identical to 044b1ab2 (mutation: push an unconditional \"\" after the Services line -> FAILS)", () => {
    expect(digestOf(everyS47cBaseInput().map((i) => buildSystemPrompt(i, now)))).toBe(PRE_S47C_DIGEST);
  }, 30_000); // 5184 prompts, ~1.2s idle: room so a loaded runner cannot time it out
});

// now = 2027-06-01T15:00:00Z = Tuesday 10:00 AM in America/Chicago (base.timezone).
const OPEN_H: OpenHours = { tue: [["08:00", "18:00"]] };
const CLOSED_H: OpenHours = { tue: [["13:00", "18:00"]], wed: [["08:00", "12:00"]] };
const HEADING = "BUSINESS HOURS (the regular weekly hours; where hours written above differ, these are right, except a closure written above for a specific date):";
const DAYS_OPEN = ["Monday: closed", "Tuesday: 8:00 AM to 6:00 PM", "Wednesday: closed", "Thursday: closed", "Friday: closed", "Saturday: closed", "Sunday: closed"];
const DAYS_CLOSED = ["Monday: closed", "Tuesday: 1:00 PM to 6:00 PM", "Wednesday: 8:00 AM to 12:00 PM", "Thursday: closed", "Friday: closed", "Saturday: closed", "Sunday: closed"];
const OPEN_BLOCK = `\n\n${[HEADING, ...DAYS_OPEN, "Right now: open until 6:00 PM."].join("\n")}`;
const CLOSED_BLOCK = `\n\n${[HEADING, ...DAYS_CLOSED, "Right now: closed; opens today at 1:00 PM."].join("\n")}`;
const LIST: RenderedService[] = [{
  name_en: "Haircut", name_es: "Corte de cabello", description_en: "Wash and cut.", description_es: "Lavado y corte.",
  sentence_en: "The price for Haircut is $25.", sentence_es: "El precio de Corte de cabello es $25.",
}];
const LIST_BLOCK = `\n\n${[
  "SERVICES AND PRICES (the only prices you may give; for a price, say that service's sentence exactly as it is written here, in the language you are speaking):",
  `- Haircut — English: "The price for Haircut is $25." Spanish: "El precio de Corte de cabello es $25."`,
  "  About it, in English: Wash and cut.",
  "  About it, in Spanish: Lavado y corte.",
].join("\n")}`;
const NAMES_BLOCK = `\n\n${["SERVICES (what the business offers):", "- Haircut (in Spanish: Corte de cabello)",
  "  About it, in English: Wash and cut.", "  About it, in Spanish: Lavado y corte."].join("\n")}`;
const TODAY_PRICE = "- Never quote a price, rate, or estimate unless one is stated above. If asked, say the business will confirm pricing and offer to take their details.";
const LIST_PRICE = "- Give a price only by saying, word for word, that service's sentence from SERVICES AND PRICES above. Any other amount written above, in the facts or the services, is not a price you may give. Never multiply, add up, estimate or round a price, never work out a total, and never quote a service that is not on the list: say the business will confirm pricing and offer to take their details. Wherever a rule below speaks of prices \"in the facts\", it means this list.";
const CLOSED_PRICE = "- Do not give, confirm or estimate any price, rate or amount right now, not even one written above. If asked, say the business will confirm pricing and offer to take their details. This overrides any rule below that allows a price from the facts.";
const PUT_THROUGH = "offer to put them through to someone on the team";
const TOOL_TODAY = "- transfer_to_human() — call this as soon as the caller asks to speak to a person, or accepts when you offer. Do not ask them to hold first; that line is spoken for you the moment the transfer starts. If the tool comes back with an error, apologize and take a message instead.";
const TOOL_CLOSED = "- transfer_to_human() — the business is closed right now, so do not offer this. Call it only when the caller asks to speak to a person. Do not ask them to hold first; that line is spoken for you the moment the transfer starts. If the tool comes back with an error, apologize and take a message instead.";
const TOOL_CLOSED_URGENT = "- transfer_to_human() — the business is closed right now, so do not offer this. Call it only when the caller asks to speak to a person, or when they accept the offer on the URGENT path in the trade rules above. Do not ask them to hold first; that line is spoken for you the moment the transfer starts. If the tool comes back with an error, apologize and take a message instead.";
const lastLine = (p: string) => p.split("\n").at(-1);

describe("buildSystemPrompt — S-47c digests", () => {
  it("null, empty and false new fields are byte-identical too, across all 5184 (mutations: treat [] as a list -> FAILS; treat {} as hours -> FAILS; close the price line when priceListUnavailable is false -> FAILS)", () => {
    expect(digestOf(everyS47cBaseInput().map((i) => buildSystemPrompt({ ...i, businessHours: null, priceList: null }, now)))).toBe(PRE_S47C_DIGEST);
    expect(digestOf(everyS47cBaseInput().map((i) => buildSystemPrompt({ ...i, businessHours: {}, priceList: [] }, now)))).toBe(PRE_S47C_DIGEST);
    // C20's closed line (with its overriding sentence) appears only when priceListUnavailable is true: false and absent stay byte-identical.
    expect(digestOf(everyS47cBaseInput().map((i) => buildSystemPrompt({ ...i, priceListUnavailable: false }, now)))).toBe(PRE_S47C_DIGEST);
  }, 30_000); // 3 x 5184 prompts: ~3.3s idle; it timed out at the 5s default once under load (Task 4 mutation run)
});

describe("buildSystemPrompt — hours (S-47c spec 5.2)", () => {
  it("open now: exactly the BUSINESS HOURS block, after the Services line, and nothing else, on every surface (72 combinations; mutation: place it after HARD LIMITS -> FAILS)", () => {
    let seen = 0;
    for (const medium of ["phone", "web", "web_voice"] as const)
      for (const handoffAvailable of [false, true])
        for (const afterHours of ["hours_then_message", "message_only"] as const)
          for (const bookingEnabled of [true, false])
            for (const tradeModule of [null, "insurance_pc", "events"] as const) {
              const input = baseInput({ medium, handoffAvailable, afterHours, bookingEnabled, tradeModule });
              const withH = buildSystemPrompt({ ...input, businessHours: OPEN_H }, now);
              expect(withH.indexOf("Services: ")).toBeLessThan(withH.indexOf(HEADING));
              expect(withH.indexOf(HEADING)).toBeLessThan(withH.indexOf("HARD LIMITS:"));
              const stripped = withH.replace(OPEN_BLOCK, "");
              // message_only on web/demo drops today's conditional line when open (spec 5.2): put it back to compare.
              const without = buildSystemPrompt(input, now);
              if (medium !== "phone" && afterHours === "message_only") expect(stripped).toBe(without.split("\n").slice(0, -2).join("\n"));
              else expect(stripped).toBe(without);
              seen += 1;
            }
    expect(seen).toBe(72);
  });
  it("closed now, web chat: the block plus the definite AFTER HOURS line, under both settings (SD6)", () => {
    for (const afterHours of ["hours_then_message", "message_only"] as const) {
      const p = buildSystemPrompt(baseInput({ medium: "web", afterHours, businessHours: CLOSED_H }), now);
      expect(p).toContain(CLOSED_BLOCK);
      expect(lastLine(p)).toBe("AFTER HOURS — The business is closed right now (see Right now above); say so briefly, and use capture_lead to get their name and a way to reach them so the team can follow up.");
      expect(p.split("AFTER HOURS").length - 1).toBe(1);
    }
  });
  it("closed now, voice demo: the definite demo line (SD6)", () => {
    const p = buildSystemPrompt(baseInput({ medium: "web_voice", afterHours: "hours_then_message", businessHours: CLOSED_H }), now);
    expect(lastLine(p)).toBe("AFTER HOURS — The business is closed right now (see Right now above); say so briefly and take a message; do not attempt anything else.");
  });
  it("closed now, phone, Follow business hours: the closed line, with the booking clause when booking is on and the person clause per SD5 (mutation: drop the hasTradeRules branch -> FAILS)", () => {
    expect(lastLine(buildSystemPrompt(baseInput({ bookingEnabled: true, handoffAvailable: false, businessHours: CLOSED_H }), now))).toBe(
      "AFTER HOURS — The business is closed right now (see Right now above). If it matters to what they need, say so and say when it opens. You can still answer questions from what you know above, and book a time that check_availability returns. For anything that needs someone on the team, take a message and say the team will call them back once it opens.");
    expect(lastLine(buildSystemPrompt(baseInput({ bookingEnabled: false, handoffAvailable: true, businessHours: CLOSED_H }), now))).toBe(
      "AFTER HOURS — The business is closed right now (see Right now above). If it matters to what they need, say so and say when it opens. You can still answer questions from what you know above. For anything that needs someone on the team, take a message and say the team will call them back once it opens. If they ask for a person, you can still put them through.");
    // Both modules, not only events (Task 4 review: `hasTradeRules: input.tradeModule === "events"` survived).
    let seen = 0;
    for (const tradeModule of ["insurance_pc", "events"] as const) {
      expect(lastLine(buildSystemPrompt(baseInput({ bookingEnabled: true, handoffAvailable: true, tradeModule, businessHours: CLOSED_H }), now)), tradeModule).toBe(
        "AFTER HOURS — The business is closed right now (see Right now above). If it matters to what they need, say so and say when it opens. You can still answer questions from what you know above, and book a time that check_availability returns. For anything that needs someone on the team, take a message and say the team will call them back once it opens. If they ask for a person, or it is urgent, you can still put them through.");
      seen += 1;
    }
    expect(seen).toBe(2);
  });
  it("phone, Always take a message: the MESSAGES ONLY line unchanged, open or closed (spec 5.2.1 point 5)", () => {
    for (const businessHours of [OPEN_H, CLOSED_H]) {
      const input = baseInput({ afterHours: "message_only", handoffAvailable: true });
      expect(lastLine(buildSystemPrompt({ ...input, businessHours }, now))).toBe(lastLine(buildSystemPrompt(input, now)));
    }
  });
});

describe("buildSystemPrompt — closed now and the offer of a person (C14, spec 5.2.1)", () => {
  // callerNumber null and booking on, so all four offer sites are in the prompt.
  const PHONE = baseInput({ handoffAvailable: true, callerNumber: null, bookingEnabled: true, afterHours: "hours_then_message" });
  const SITES = [
    "then offer to take a message if they would rather talk to a person. Never claim to be human.",
    "if they ask, offer to take a message instead.",
    "If either refuses, apologize and offer to take a message.",
    "and offer to take a message, or suggest they call back from that phone.",
  ];
  it("all four offer sites read 'offer to take a message' and none offers a transfer (mutation: ignore closedNow in the offer -> FAILS)", () => {
    for (const disclosed of [false, true]) {
      const p = buildSystemPrompt({ ...PHONE, disclosed, businessHours: CLOSED_H }, now);
      for (const s of SITES.slice(disclosed ? 1 : 0)) expect(p, s).toContain(s);
      if (disclosed) expect(p).toContain("Then offer to take a message if they would rather talk to a person.");
      expect(p).not.toContain(PUT_THROUGH);
    }
  });
  it("the TOOLS line is the closed one; with a trade module it names the URGENT path; transfer_to_human stays on the session (mutation: drop the tool when closed -> FAILS)", () => {
    const none = buildSystemPrompt({ ...PHONE, businessHours: CLOSED_H }, now);
    expect(none).toContain(TOOL_CLOSED);
    expect(none).not.toContain(TOOL_TODAY);
    // Both modules, not only events (Task 4 review: `hasTradeRules: input.tradeModule === "events"` survived).
    let seen = 0;
    for (const tradeModule of ["insurance_pc", "events"] as const) {
      const withModule = buildSystemPrompt({ ...PHONE, tradeModule, businessHours: CLOSED_H }, now);
      expect(withModule, tradeModule).toContain(TOOL_CLOSED_URGENT);
      expect(withModule, tradeModule).not.toContain(TOOL_TODAY);
      seen += 1;
    }
    expect(seen).toBe(2);
    const tools = buildRealtimeSessionConfig({ ...PHONE, businessHours: CLOSED_H }, now).tools as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toContain("transfer_to_human");
  });
  it("an explicit medium: \"phone\" is the phone too: closed, it offers a message and the TOOLS line is the closed one (Task 4 review; mutation: closedNow keyed on !input.medium -> FAILS)", () => {
    const p = buildSystemPrompt({ ...PHONE, medium: "phone", businessHours: CLOSED_H }, now);
    expect(p).toContain(TOOL_CLOSED);
    expect(p).not.toContain(TOOL_TODAY);
    expect(p).not.toContain(PUT_THROUGH);
    expect(p).toContain("If either refuses, apologize and offer to take a message.");
  });
  it("the trade module block is byte-identical closed and open (C12: the module still gets handoffAvailable; mutation: pass !closedNow -> FAILS)", () => {
    for (const tradeModule of ["insurance_pc", "events"] as const) {
      const block = (p: string) => p.slice(p.indexOf("TRADE RULES —"), p.indexOf("\n\nTOOLS"));
      const closed = buildSystemPrompt({ ...PHONE, tradeModule, businessHours: CLOSED_H }, now);
      const open = buildSystemPrompt({ ...PHONE, tradeModule, businessHours: OPEN_H }, now);
      expect(block(closed).length).toBeGreaterThan(100);
      expect(block(closed)).toBe(block(open));
    }
  });
  it("open now: the no-hours prompt plus the block, nothing else (the offer and TOOLS lines are today's)", () => {
    expect(buildSystemPrompt({ ...PHONE, businessHours: OPEN_H }, now).replace(OPEN_BLOCK, "")).toBe(buildSystemPrompt(PHONE, now));
  });
  it("web chat and voice demo, closed: no C14 line at all, even with handoffAvailable", () => {
    for (const medium of ["web", "web_voice"] as const) {
      const p = buildSystemPrompt({ ...PHONE, medium, businessHours: CLOSED_H }, now);
      expect(p).not.toContain("the business is closed right now, so do not offer this");
    }
    const demo = buildSystemPrompt({ ...PHONE, medium: "web_voice", businessHours: CLOSED_H }, now);
    expect(demo).toContain(PUT_THROUGH); // today's demo wording, untouched
  });
  // C19 (owner, 2026-10-23; asked as OQ1 in the first draft): under Always take a message nothing about transfers changes with the hours.
  it("C19: Always take a message, closed: the offers and the TOOLS line are today's (mutation: drop the afterHours term from closedNow -> FAILS)", () => {
    const p = buildSystemPrompt({ ...PHONE, afterHours: "message_only", businessHours: CLOSED_H }, now);
    expect(p).toContain(PUT_THROUGH);
    expect(p).toContain(TOOL_TODAY);
  });
});

describe("buildSystemPrompt — the price list (S-47c spec 5.2, 5.4)", () => {
  it("a list alone adds the list after the Services line and swaps exactly the one HARD LIMITS line (mutation: keep today's line too -> FAILS)", () => {
    for (const medium of ["phone", "web", "web_voice"] as const)
      for (const tradeModule of [null, "events"] as const) {
        const input = baseInput({ medium, tradeModule });
        const withL = buildSystemPrompt({ ...input, priceList: LIST }, now);
        expect(withL).toContain(LIST_BLOCK);
        expect(withL.split(LIST_PRICE).length - 1).toBe(1);
        expect(withL).not.toContain(TODAY_PRICE);
        expect(withL.replace(LIST_BLOCK, "").replace(LIST_PRICE, TODAY_PRICE)).toBe(buildSystemPrompt(input, now));
      }
  });
  it("hours and a list together: hours first, then the list, both before HARD LIMITS", () => {
    const p = buildSystemPrompt(baseInput({ businessHours: OPEN_H, priceList: LIST }), now);
    expect(p).toContain(`${OPEN_BLOCK}${LIST_BLOCK}\n\nHARD LIMITS:`);
  });
  it("insurance: names and descriptions only, no sentence, no amount, today's HARD LIMITS line (C13; mutation: print the sentences on insurance -> FAILS)", () => {
    const p = buildSystemPrompt(baseInput({ tradeModule: "insurance_pc", priceList: LIST }), now);
    expect(p).toContain(NAMES_BLOCK);
    expect(p).toContain(TODAY_PRICE);
    for (const s of ["The price for Haircut", "El precio de", "$25", "SERVICES AND PRICES", LIST_PRICE]) expect(p).not.toContain(s);
  });
  it("events: the module's own words are untouched and the list sits above them (C12)", () => {
    const p = buildSystemPrompt(baseInput({ tradeModule: "events", priceList: LIST }), now);
    expect(p.indexOf("SERVICES AND PRICES")).toBeLessThan(p.indexOf("TRADE RULES — EVENTS AND VENUES:"));
    expect(p).toContain("- You may give prices, packages, deposits, payment plans and refund or cancellation terms only by repeating what the facts above say, word for word, with every number exactly as it is written there. For these, and only these, this overrides the TONE line about not reading the facts verbatim.");
  });
  it("C20: a FAILED list read closes the price line, on every surface, and changes nothing else (mutation: ignore priceListUnavailable -> FAILS)", () => {
    for (const medium of ["phone", "web", "web_voice"] as const) {
      const input = baseInput({ medium });
      const closed = buildSystemPrompt({ ...input, priceList: null, priceListUnavailable: true }, now);
      expect(closed).toContain(CLOSED_PRICE);
      expect(closed).not.toContain(TODAY_PRICE);
      expect(closed.replace(CLOSED_PRICE, TODAY_PRICE)).toBe(buildSystemPrompt(input, now));
    }
  });
  it("C20: an EMPTY list is not a failure: today's line, byte for byte (mutation: treat [] as unavailable -> FAILS)", () => {
    expect(buildSystemPrompt(baseInput({ priceList: [], priceListUnavailable: false }), now)).toBe(buildSystemPrompt(baseInput(), now));
  });
  it("C20: an events account gets the closed line WITH its overriding sentence, and the module's own words are untouched (C12; mutation: drop the last sentence -> FAILS)", () => {
    const p = buildSystemPrompt(baseInput({ tradeModule: "events", priceListUnavailable: true }), now);
    expect(p).toContain(CLOSED_PRICE);
    expect(p.split("\n")).toContain(CLOSED_PRICE);
    expect(p).not.toContain(TODAY_PRICE);
    expect(p).toContain("- You may give prices, packages, deposits, payment plans and refund or cancellation terms only by repeating what the facts above say, word for word, with every number exactly as it is written there. For these, and only these, this overrides the TONE line about not reading the facts verbatim.");
  });
  it("C20: insurance keeps today's line on a failed read (the module already forbids every quote; mutation: close it on insurance -> FAILS)", () => {
    const p = buildSystemPrompt(baseInput({ tradeModule: "insurance_pc", priceListUnavailable: true }), now);
    expect(p).toContain(TODAY_PRICE);
    expect(p).not.toContain(CLOSED_PRICE);
  });
});
