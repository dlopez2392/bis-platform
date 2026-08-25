import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./system-prompt";

const base = {
  personaName: "Sofía", businessName: "Rio Roofing",
  greeting: "Thanks for calling Rio Roofing. How can I help?",
  facts: "- We repair and replace residential roofs in the RGV.",
  services: "Roof repair, full replacement, inspections",
  languages: "both" as const, bookingEnabled: true,
  timezone: "America/Chicago", slotDurationMinutes: 60,
  afterHours: "hours_then_message" as const, callerNumber: "+19562921696",
};
const now = new Date("2027-06-01T15:00:00Z");

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
});
