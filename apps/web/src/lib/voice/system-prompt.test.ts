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
});
