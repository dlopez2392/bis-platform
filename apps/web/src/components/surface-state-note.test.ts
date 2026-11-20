import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import type { CapabilityGrade } from "@/lib/surfaces/capabilities";
import {
  SurfaceStateNote, TONE, capabilityLink, capabilityPill, capabilitySentenceKey, sofiaLink, sofiaPill, sofiaSentenceKey,
  textingSentenceKey, webChatSentenceKey,
} from "./surface-state-note";

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
    expect(sofiaLink(g("bigger_plan", "plan_no_voice"), OWNER, "a1", "en")).toEqual({ href: BILLING, label: "Plan and billing" });
    expect(sofiaLink(g("bigger_plan", "plan_no_voice"), OWNER, "a1", "es")?.label).toBe("Plan y facturación");
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

// F-088 PR 3: the chat's and texting's words, and the row helpers Plan and billing reads.
describe("webChatSentenceKey and textingSentenceKey", () => {
  const words = (key: ReturnType<typeof webChatSentenceKey>) => m[key];
  it("every reason the grade can return for the chat has its own words, client and agency", () => {
    expect(words(webChatSentenceKey(g("live", "chat_open"), OWNER))).toContain("answering your visitors");
    expect(words(webChatSentenceKey(g("needs_setup", "chat_off"), OWNER))).toBe("BIS is setting up the chat on your website.");
    expect(words(webChatSentenceKey(g("needs_setup", "chat_off"), AGENCY))).toContain("Voice page");
    expect(words(webChatSentenceKey(g("needs_setup", "no_trade"), AGENCY))).toContain("Settings page");
    expect(words(webChatSentenceKey(g("bigger_plan", "plan_no_chat"), OWNER))).toBe("Your plan doesn't include the website chat.");
    expect(words(webChatSentenceKey(g("bigger_plan", "plan_no_chat"), AGENCY))).toBe("This plan doesn't include the website chat.");
    expect(words(webChatSentenceKey(g("waiting", "billing_paused"), OWNER))).toContain("paused");
    expect(words(webChatSentenceKey(g("absent", "crm_only_trade"), OWNER))).toContain("isn't offered");
  });
  it("a reason that is not the chat's reads as 'could not check', never as live", () => {
    expect(webChatSentenceKey(g("live", "sofia_answering"), OWNER)).toBe("surface.chat.read_failed");
    expect(textingSentenceKey(g("live", "chat_open"), OWNER)).toBe("surface.texting.read_failed");
  });
  it("texting: live says set up and nothing about sending; waiting names the carriers; no A2P jargon in any English words", () => {
    expect(m[textingSentenceKey(g("live", "texting_registered"), OWNER)]).toBe("Texting is set up for your business.");
    expect(m[textingSentenceKey(g("waiting", "carrier_review"), OWNER)]).toBe("Texting is waiting on the phone carriers' approval.");
    for (const reason of ["texting_registered", "carrier_review", "not_registered", "registration_rejected", "read_failed"] as const) {
      for (const reader of [OWNER, AGENCY]) expect(m[textingSentenceKey(g("needs_setup", reason), reader)]).not.toMatch(/A2P|10DLC|campaign/i);
    }
  });
});

describe("capabilitySentenceKey, capabilityPill, capabilityLink", () => {
  it("dispatches to the capability's own words, and Sofía keeps her overrides", () => {
    expect(capabilitySentenceKey("sofia", g("bigger_plan", "plan_no_voice"), OWNER)).toBe("surface.sofia.plan_no_voice");
    expect(capabilitySentenceKey("webChat", g("bigger_plan", "plan_no_chat"), OWNER)).toBe("surface.chat.plan_no_chat");
    expect(capabilitySentenceKey("texting", g("waiting", "carrier_review"), OWNER)).toBe("surface.texting.carrier_review");
    expect(capabilityPill("sofia", g("live", "sofia_testing"), "en")).toBe("Testing");
    expect(capabilityPill("webChat", g("needs_setup", "read_failed"), "en")).toBeNull();
    expect(capabilityPill("texting", g("needs_setup", "read_failed"), "en")).toBeNull();
    expect(capabilityPill("texting", g("waiting", "carrier_review"), "en")).toBeUndefined();
  });
  it("only the agency gets a link, to the page that fixes it; a client reading Plan and billing never gets one (not even to itself)", () => {
    const base = "/dashboard/accounts/a1";
    expect(capabilityLink("texting", g("needs_setup", "not_registered"), AGENCY, "a1", "en")).toEqual({ href: `${base}/checklist`, label: "Open the Checklist page" });
    expect(capabilityLink("webChat", g("needs_setup", "chat_off"), AGENCY, "a1", "en")?.href).toBe(`${base}/voice`);
    expect(capabilityLink("sofia", g("needs_setup", "no_trade"), AGENCY, "a1", "en")?.href).toBe(`${base}/settings`);
    expect(capabilityLink("webChat", g("needs_setup", "read_failed"), AGENCY, "a1", "en")).toBeUndefined();
    expect(capabilityLink("webChat", g("bigger_plan", "plan_no_chat"), AGENCY, "a1", "en")).toBeUndefined();
    for (const reason of ["chat_off", "not_registered", "sofia_off"] as const) {
      expect(capabilityLink("webChat", g("needs_setup", reason), OWNER, "a1", "en")).toBeUndefined();
    }
    expect(capabilityLink("sofia", g("bigger_plan", "plan_no_voice"), OWNER, "a1", "en")).toBeUndefined();
  });
});

describe("SurfaceStateNote align", () => {
  it("'start' is a left-aligned row for a card; the default stays the centred empty-state note", () => {
    const html = (align?: "start" | "center") => renderToStaticMarkup(
      createElement(SurfaceStateNote, { state: "live", sentence: "S.", locale: "en", align }));
    expect(html()).toContain("items-center");
    expect(html("start")).toContain("items-start");
    expect(html("start")).not.toContain("text-center");
  });
});
