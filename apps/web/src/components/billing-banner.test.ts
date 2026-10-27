import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import type { Locale } from "@/lib/i18n/locale";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: unknown; className?: string }) =>
    createElement("a", { href, className }, children as never),
}));
const nav = vi.hoisted(() => ({ pathname: "/dashboard/accounts/acct_1/dashboard" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
const { BillingBanner } = await import("./billing-banner");
const render = (audience: "client" | "agency", locale: Locale = "en") =>
  renderToStaticMarkup(createElement(BillingBanner, { audience, accountId: "acct_1", locale }));

describe("BillingBanner", () => {
  it("tells the CLIENT, in the spec's words, and links to their own Billing page (mutation: link to Settings → a client cannot open it, FAILS)", () => {
    const html = render("client");
    expect(renderedText(html).replace(/\s+/g, " ").trim()).toBe(`${m["billing.banner.client"]} ${m["billing.banner.clientAction"]}`);
    expect(html).toContain('href="/dashboard/accounts/acct_1/billing"');
    // renderedText strips tags to spaces, so a missing `{" "}` between the
    // sentence and the link would still read as one space in the plain-text
    // assertion above. Assert the RAW markup too: a real gap, not a tag.
    expect(html).toMatch(/running\. <a /);
  });

  it("on the Billing page itself the client's banner carries no \"Go to Billing\" link (design review M2) (mutation: always render the link → FAILS)", () => {
    nav.pathname = "/dashboard/accounts/acct_1/billing";
    try {
      const html = render("client");
      expect(html).not.toContain("<a ");
      expect(renderedText(html)).toContain(m["billing.banner.client"]);
    } finally {
      nav.pathname = "/dashboard/accounts/acct_1/dashboard";
    }
  });

  it("tells the AGENCY, inside that account, and links to the Billing card (mutation: show the client sentence to the agency → FAILS)", () => {
    const html = render("agency");
    expect(renderedText(html).replace(/\s+/g, " ").trim()).toBe(`${m["billing.banner.agency"]} ${m["billing.banner.agencyAction"]}`);
    expect(html).toContain('href="/dashboard/accounts/acct_1/settings#billing"');
  });

  it("is a standing note, not an alert (rule 3): the sentence is the marker (mutation: role=alert → announced on every navigation, FAILS)", () => {
    const html = render("client");
    expect(html).toContain('role="note"');
    expect(renderedText(html)).toContain(m["billing.banner.client"]);
  });

  // PR-4 Task 10: bilingual, through t() and a lang-carrying span, the same
  // placement the paused banner uses — never on the Notice itself, which
  // also carries the link.
  it("renders the CLIENT sentence and link in Spanish, with lang on the span, for an es locale (mutation: drop t()/lang and keep the raw English key → FAILS)", () => {
    const html = render("client", "es");
    expect(html).toMatch(/<span lang="es">/);
    const text = renderedText(html);
    expect(text).toContain(m["billing.banner.client.es"]);
    expect(text).toContain(m["billing.banner.clientAction.es"]);
    expect(text).not.toContain(m["billing.banner.client"]);
  });

  it("renders the AGENCY sentence and link in Spanish too, for an es locale (mutation: hard-code English for the agency branch → FAILS)", () => {
    const html = render("agency", "es");
    expect(html).toMatch(/<span lang="es">/);
    const text = renderedText(html);
    expect(text).toContain(m["billing.banner.agency.es"]);
    expect(text).toContain(m["billing.banner.agencyAction.es"]);
  });
});
