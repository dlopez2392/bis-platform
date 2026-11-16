import { describe, it, expect } from "vitest";
import { TRADE_ENTRIES } from "@/lib/vetting/trades";
import {
  parseProspectDemo, buildProspectDemoSession, PROSPECT_DEMO_MAX_SERVICES, type ProspectDemoForm,
} from "./prospect-demo";

const NOW = new Date("2026-11-16T15:00:00Z"); // a Monday, 9:00 AM in Chicago

function form(over: Partial<ProspectDemoForm> = {}): ProspectDemoForm {
  return {
    businessName: "Garza Lawn & Garden", trade: "landscaping", tradeOther: "", languages: "en",
    hours: {
      weekdays: { open: true, from: "08:00", to: "17:00" },
      saturday: { open: true, from: "08:00", to: "12:00" },
      sunday: { open: false, from: "", to: "" },
    },
    services: [
      { name: "Lawn mowing", price: "45", minutes: "40" },
      { name: "Hedge trimming", price: "", minutes: "" },
    ],
    ...over,
  };
}

function built(over: Partial<ProspectDemoForm> = {}) {
  const parsed = parseProspectDemo(form(over));
  if (!parsed.ok) throw new Error(`fixture refused: ${parsed.error}`);
  return buildProspectDemoSession(parsed.profile, NOW);
}

describe("parseProspectDemo: the trade gate", () => {
  it("refuses a held health trade with the trade's own reason (mutation: drop the gate -> FAILS)", () => {
    const reason = TRADE_ENTRIES.find((e) => e.key === "dental")!.reason!.en;
    expect(parseProspectDemo(form({ trade: "dental" }))).toEqual({ ok: false, error: reason });
  });

  it("refuses a turned-away trade with its reason", () => {
    const reason = TRADE_ENTRIES.find((e) => e.key === "home_health")!.reason!.en;
    expect(parseProspectDemo(form({ trade: "home_health" }))).toEqual({ ok: false, error: reason });
  });

  it("refuses a CRM-only trade, because Sofía cannot be switched on for it", () => {
    const r = parseProspectDemo(form({ trade: "restaurant" }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/restaurant/i);
  });

  it("refuses an unknown trade key", () => {
    expect(parseProspectDemo(form({ trade: "crypto_mining" })).ok).toBe(false);
  });

  it("takes Other with a one-line description", () => {
    const r = parseProspectDemo(form({ trade: "other", tradeOther: "Mobile knife sharpening" }));
    expect(r.ok).toBe(true);
  });
});

describe("parseProspectDemo: the rest of the form", () => {
  it("needs a business name", () => {
    expect(parseProspectDemo(form({ businessName: "   " })).ok).toBe(false);
  });

  it("needs at least one open day", () => {
    const closed = { open: false, from: "", to: "" };
    expect(parseProspectDemo(form({ hours: { weekdays: closed, saturday: closed, sunday: closed } })).ok).toBe(false);
  });

  it("refuses a closing time before the opening time", () => {
    const r = parseProspectDemo(form({ hours: { ...form().hours, weekdays: { open: true, from: "17:00", to: "08:00" } } }));
    expect(r.ok).toBe(false);
  });

  it(`refuses more than ${PROSPECT_DEMO_MAX_SERVICES} services`, () => {
    const many = Array.from({ length: PROSPECT_DEMO_MAX_SERVICES + 1 }, (_, i) => ({ name: `S${i}`, price: "", minutes: "" }));
    expect(parseProspectDemo(form({ services: many })).ok).toBe(false);
  });

  it("refuses a price that is not an amount", () => {
    expect(parseProspectDemo(form({ services: [{ name: "Mowing", price: "cheap", minutes: "" }] })).ok).toBe(false);
  });

  it("drops a service row left blank instead of refusing it", () => {
    const r = parseProspectDemo(form({ services: [{ name: "Mowing", price: "", minutes: "" }, { name: " ", price: "", minutes: "" }] }));
    expect(r.ok && r.profile.services).toHaveLength(1);
  });

  it("refuses a value that did not come from the form at all", () => {
    expect(parseProspectDemo(null).ok).toBe(false);
    expect(parseProspectDemo({ ...form(), languages: "fr" }).ok).toBe(false);
  });
});

describe("buildProspectDemoSession", () => {
  it("gives the session NO tools (mutation: let the builder's tools through -> FAILS)", () => {
    expect(built().session.tools).toEqual([]);
  });

  it("greets as the prospect's business, with the AI sentence a disclosing call says", () => {
    const { greeting } = built();
    expect(greeting).toContain("Thanks for calling Garza Lawn & Garden.");
    expect(greeting).toContain("I'm Sofía, an AI assistant.");
  });

  it("greets in Spanish for a Spanish-only business, and in both for a bilingual one", () => {
    expect(built({ languages: "es" }).greeting).toContain("Gracias por llamar a Garza Lawn & Garden.");
    const both = built({ languages: "both" }).greeting;
    expect(both).toContain("Thanks for calling Garza Lawn & Garden.");
    expect(both).toContain("Gracias por llamar a Garza Lawn & Garden.");
  });

  it("tells her the typed hours, services and prices as facts", () => {
    const { instructions } = built().session;
    expect(instructions).toContain("Monday: 8:00 AM to 5:00 PM");
    expect(instructions).toContain("Saturday: 8:00 AM to 12:00 PM");
    expect(instructions).toContain("Sunday: closed");
    expect(instructions).toContain("The price for Lawn mowing is $45.");
    expect(instructions).toContain("Hedge trimming");
    expect(instructions).toContain("about 40 minutes");
    expect(instructions).toContain("Landscaping and lawn care");
  });

  it("carries the disclosed IDENTITY line, the same one a disclosing phone call gets", () => {
    expect(built().session.instructions).toContain("You have already told the caller that you are Sofía, an AI assistant.");
  });

  it("tells her this is a preview where nothing is booked or saved", () => {
    const { instructions } = built().session;
    expect(instructions).toContain("You CANNOT book, reschedule or cancel anything in this conversation");
    expect(instructions).not.toContain("contact form on this website");
  });

  it("is built by the same builder as the phone line: same model, voice and turn detection", () => {
    const { session } = built();
    expect(session.type).toBe("realtime");
    expect(session.audio.output.voice).toBe("marin");
    expect(session.audio.input.turn_detection).toBeTruthy();
  });
});
