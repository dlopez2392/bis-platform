import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** The AI apps cards' markup (plan 3.6, DESIGN rules 3, 5, 8). Client components: the server render is what is read. */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { AiAppsCard, AiAppsCardError } = await import("./ai-apps-card");
const { AiAppsUseCard, AiAppsUseCardError } = await import("./ai-apps-use-card");

const ON = { enabledAt: "2026-11-19T20:00:00.000Z", changedAt: "2026-11-19T20:00:00.000Z", changedBy: "u1" };
const NEVER = { enabledAt: null, changedAt: null, changedBy: null };
const LOG = [{ who: "Ana Ruiz", kind: "ai_app_appointments" as const, at: "2026-11-19T20:30:00.000Z" }];
const set = async () => ({ ok: false as const, error: "x" });
const card = (o: Partial<Parameters<typeof AiAppsCard>[0]> = {}) => renderToStaticMarkup(createElement(AiAppsCard, {
  state: ON, changedByName: "Maria Lopez", log: LOG, viewer: "owner", locale: "en", zone: "America/Chicago", pseudo: false,
  setSwitch: set, ...o,
}));

describe("AiAppsCard", () => {
  it("the Owner gets one switch named for the business, with the state as dot + word (mutation: drop role=switch -> FAILS)", () => {
    const html = card();
    expect(html.match(/role="switch"/g)).toHaveLength(1);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="AI apps for this business"');
    expect(html).toContain(">On<");
    expect(html).toContain("What they read is sent to that app");
  });
  it("the agency sees the state and who changed it, and no control at all (mutation: render the switch for the agency -> FAILS)", () => {
    const html = card({ viewer: "agency" });
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain("<button");
    expect(html).toContain("Only the business&#x27;s Owner can change this.");
    expect(html).toContain("Turned on by Maria Lopez, Nov 19, 2:00 PM.");
  });
  it("a switch that was never turned on says so instead of inventing a time (mutation: always print the record -> FAILS)", () => {
    const html = card({ state: NEVER, changedByName: null, log: [] });
    expect(html).toContain("It has never been turned on.");
    expect(html).not.toContain("Turned on by");
    expect(html).toContain('aria-checked="false"');
  });
  it("with no name for the Owner it says 'the Owner', never blank (mutation: print null -> FAILS)", () => {
    expect(card({ changedByName: null })).toContain("Turned on by the Owner,");
  });
  it("lists the reads: who, which read in words, when in the account's zone", () => {
    const html = card();
    expect(html).toContain("Ana Ruiz");
    expect(html).toContain("read appointments");
    expect(html).toContain("Nov 19, 2:30 PM");
  });
  it("an empty log has its own sentence (rule 5; mutation: render an empty list -> FAILS)", () => {
    const html = card({ log: [] });
    expect(html).toContain("data-ai-apps-log-empty");
    expect(html).toContain("Nothing has been read yet.");
  });
  it("a log that could not be read costs only the log, and the switch stays (rule 5 on the card)", () => {
    const html = card({ log: null });
    expect(html).toContain("data-ai-apps-log-error");
    expect(html).toContain('role="switch"');
  });
  it("says its language, and Spanish uses usted and the Spanish words (mutation: drop lang -> FAILS)", () => {
    const html = card({ locale: "es", viewer: "agency" });
    expect(html).toMatch(/lang="es"/);
    expect(html).toContain("Aplicaciones de IA");
    expect(html).toContain("Solo el Dueño del negocio puede cambiar esto.");
  });
  it("its own error state offers no control", () => {
    const html = renderToStaticMarkup(createElement(AiAppsCardError, { locale: "en", pseudo: false }));
    expect(html).toContain("data-ai-apps-card-error");
    expect(html).not.toContain("<button");
  });
});

const useCard = (o: Partial<Parameters<typeof AiAppsUseCard>[0]> = {}) => renderToStaticMarkup(createElement(AiAppsUseCard, {
  url: "https://app.bis-rgv.com/api/mcp", locale: "en", pseudo: false,
  rows: [
    { accountId: "a", businessName: "Alpha Co", role: "owner", state: "off" },
    { accountId: "b", businessName: "Zeta Co", role: "staff", state: "off" },
    { accountId: "c", businessName: "Cedar Co", role: "owner", state: "on" },
    { accountId: "d", businessName: "Dune Co", role: "owner", state: "unknown" },
  ], ...o,
}));

describe("AiAppsUseCard (Mis preferencias)", () => {
  it("shows the address in a labelled, selectable field with a copy button that names what it copies", () => {
    const html = useCard();
    expect(html).toContain("https://app.bis-rgv.com/api/mcp");
    expect(html).toContain('aria-label="Copy the server address"');
  });
  it("carries both how-tos in words", () => {
    const html = useCard();
    expect(html).toContain("Add custom connector");
    expect(html).toContain("developer mode");
  });
  it("per business: on and off as dot + word; an Owner is pointed at Team, Staff are told to ask the Owner; unknown is its own words", () => {
    const html = useCard();
    expect(html).toContain("/dashboard/accounts/a/team#ai-apps");
    expect(html).not.toContain("/dashboard/accounts/b/team");
    expect(html).toContain("Ask the Owner to switch them on.");
    expect(html).toContain("AI apps are on");
    expect(html).toContain("We couldn&#x27;t read this one.");
  });
  it("no address: says so and shows no copy button (mutation: render the button anyway -> FAILS)", () => {
    const html = useCard({ url: null });
    expect(html).toContain("The address is not available right now.");
    expect(html).not.toContain("Copy the server address");
  });
  it("Spanish says 'su negocio'-side words: Dueño, aplicación de IA, usted", () => {
    const html = useCard({ locale: "es" });
    expect(html).toContain("Use BIS desde su aplicación de IA");
    expect(html).toContain("Pídale al Dueño que las encienda.");
  });
  it("its error state is a card of its own", () => {
    expect(renderToStaticMarkup(createElement(AiAppsUseCardError, { locale: "en", pseudo: false }))).toContain("data-ai-apps-use-card-error");
  });
});
