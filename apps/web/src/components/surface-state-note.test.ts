import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import type { CapabilityGrade } from "@/lib/surfaces/capabilities";
import { SurfaceStateNote, TONE, sofiaLink, sofiaPill, sofiaSentenceKey } from "./surface-state-note";

const AGENCY = { isAgency: true, role: null } as const;
const OWNER = { isAgency: false, role: "owner" } as const;
const g = (state: CapabilityGrade["state"], reason: CapabilityGrade["reason"]): CapabilityGrade => ({ state, reason });

describe("SurfaceStateNote", () => {
  it("no chip word sits on --text-3 (3.1:1 on --surface-2 in light, under AA); only a dot may", () => {
    for (const [state, tone] of Object.entries(TONE)) {
      expect(tone.chip, state).not.toContain("text-[var(--text-3)]");
    }
  });
  it("renders the state's own word by default, a reason word when given, and no pill at all for null", () => {
    const html = (word?: string | null) => renderToStaticMarkup(
      createElement(SurfaceStateNote, { state: "live", sentence: "S.", word, locale: "en" }));
    expect(html()).toContain(">Live<");
    expect(html("Testing")).toContain(">Testing<");
    expect(html("Testing")).not.toContain(">Live<");
    expect(html(null)).not.toContain("size-[7px]");
  });
});

describe("sofiaPill", () => {
  it("overrides the word for testing and forwarded calls, and drops the pill for a failed read", () => {
    expect(sofiaPill(g("live", "sofia_testing"), "en")).toBe("Testing");
    expect(sofiaPill(g("live", "sofia_testing"), "es")).toBe("En prueba");
    expect(sofiaPill(g("needs_setup", "calls_forwarded"), "en")).toBe("Calls forwarded");
    expect(sofiaPill(g("needs_setup", "calls_forwarded"), "es")).toBe("Llamadas reenviadas");
    expect(sofiaPill(g("needs_setup", "read_failed"), "en")).toBeNull();
    expect(sofiaPill(g("needs_setup", "sofia_off"), "en")).toBeUndefined();
  });
});

describe("sofiaSentenceKey", () => {
  it("an unexpected (non-Sofía) reason reads as 'could not check', never as answering", () => {
    expect(sofiaSentenceKey(g("live", "chat_open"), OWNER)).toBe("surface.sofia.read_failed");
    expect(sofiaSentenceKey(g("live", "texting_registered"), AGENCY)).toBe("surface.sofia.read_failed");
  });
  it("each agency setup reason reads its own words, and a client reads that BIS is setting up", () => {
    const words = (reason: CapabilityGrade["reason"]) => m[sofiaSentenceKey(g("needs_setup", reason), AGENCY)];
    expect(words("sofia_off")).toContain("switched off");
    expect(words("no_number")).toContain("no phone number answers");
    expect(words("no_trade")).toContain("Settings page");
    expect(words("calls_forwarded")).toContain("Call forwarding is on");
    for (const reason of ["sofia_off", "no_number", "no_trade"] as const) {
      expect(m[sofiaSentenceKey(g("needs_setup", reason), OWNER)]).toBe("BIS is setting up Sofía.");
    }
    expect(m[sofiaSentenceKey(g("needs_setup", "calls_forwarded"), OWNER)]).toContain("go straight to your phone");
  });
});

describe("sofiaLink", () => {
  const BILLING = "/dashboard/accounts/a1/billing";
  it("the Billing page is an Owner's: not the agency's, not Staff's, not a Technician's, and labelled with the page's own title", () => {
    expect(sofiaLink(g("bigger_plan", "plan_no_voice"), OWNER, "a1", "en")).toEqual({ href: BILLING, label: "Billing" });
    expect(sofiaLink(g("bigger_plan", "plan_no_voice"), OWNER, "a1", "es")?.label).toBe("Facturación");
    expect(sofiaLink(g("bigger_plan", "plan_no_voice"), AGENCY, "a1", "en")).toBeUndefined();
    for (const role of ["staff", "technician", null] as const) {
      expect(sofiaLink(g("bigger_plan", "plan_no_voice"), { isAgency: false, role }, "a1", "en")).toBeUndefined();
    }
  });
  it("the agency's setup links: Settings for the trade, Voice for the rest, none for a failed read or for a client", () => {
    expect(sofiaLink(g("needs_setup", "no_trade"), AGENCY, "a1", "en")?.href).toBe("/dashboard/accounts/a1/settings");
    for (const reason of ["sofia_off", "no_number", "calls_forwarded"] as const) {
      expect(sofiaLink(g("needs_setup", reason), AGENCY, "a1", "en")?.href).toBe("/dashboard/accounts/a1/voice");
    }
    expect(sofiaLink(g("needs_setup", "read_failed"), AGENCY, "a1", "en")).toBeUndefined();
    expect(sofiaLink(g("needs_setup", "sofia_off"), OWNER, "a1", "en")).toBeUndefined();
    expect(sofiaLink(g("absent", "crm_only_trade"), AGENCY, "a1", "en")).toBeUndefined();
  });
});
