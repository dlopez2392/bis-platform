import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

/**
 * M7a PR-4 Task 10 (plan G12): the paused banner, on every page of a paused
 * account, for every audience. role="note" (DESIGN rule 3: the sentence is
 * the marker). The banner never mentions "phone" — pinned at the copy level
 * already (messages.test.ts); this file pins the WIRING: which audience
 * gets which sentence, which link, and the resolved locale.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: unknown; className?: string }) =>
    createElement("a", { href, className }, children as never),
}));
// The current path, for the "Go to Billing" link that hides on the Billing page itself (M2).
const nav = vi.hoisted(() => ({ pathname: "/dashboard/accounts/acct_1/dashboard" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
const { BillingPausedBanner } = await import("./billing-paused-banner");

const render = (props: Parameters<typeof BillingPausedBanner>[0]) =>
  renderToStaticMarkup(createElement(BillingPausedBanner, props));

describe("BillingPausedBanner", () => {
  it("tells the client OWNER the payment sentence, with a Go to Billing link to their own Billing page (mutation: link to Settings → a client cannot open it, FAILS)", () => {
    const html = render({ audience: "owner", accountId: "acct_1", cause: "payment", locale: "en" });
    expect(renderedText(html).replace(/\s+/g, " ").trim())
      .toBe(`${m["billing.paused.client.payment"]} ${m["billing.paused.client.action"]}`);
    expect(html).toContain('href="/dashboard/accounts/acct_1/billing"');
  });

  it("tells the client OWNER the ended sentence for an ended plan, never the payment one (mutation: always use the payment key → FAILS)", () => {
    const html = render({ audience: "owner", accountId: "acct_1", cause: "ended", locale: "en" });
    const text = renderedText(html);
    expect(text).toContain(m["billing.paused.client.ended"]);
    expect(text).not.toContain(m["billing.paused.client.payment"]);
  });

  it("tells Staff/Technicians (member) the staff line instead of a link — Billing is Owner-only (mutation: render the owner's link for a member → FAILS)", () => {
    const html = render({ audience: "member", accountId: "acct_1", cause: "payment", locale: "en" });
    expect(renderedText(html).replace(/\s+/g, " ").trim())
      .toBe(`${m["billing.paused.client.payment"]} ${m["billing.paused.client.staff"]}`);
    expect(html).not.toContain("<a ");
  });

  it("tells the AGENCY its own sentence and links to the Settings card, never the client's wording (mutation: show the client sentence to the agency → FAILS)", () => {
    const html = render({ audience: "agency", accountId: "acct_1", cause: "payment", locale: "en" });
    expect(renderedText(html).replace(/\s+/g, " ").trim())
      .toBe(`${m["billing.paused.agency"]} ${m["billing.paused.agencyAction"]}`);
    expect(html).toContain('href="/dashboard/accounts/acct_1/settings#billing"');
  });

  it("is a standing note, not an alert (rule 3): the sentence is the marker (mutation: role=alert → announced on every navigation, FAILS)", () => {
    const html = render({ audience: "owner", accountId: "acct_1", cause: "payment", locale: "en" });
    expect(html).toContain('role="note"');
  });

  it("sets lang on the client sentence for a Spanish account, and renders the Spanish words (mutation: drop the lang attribute or the locale lookup → FAILS)", () => {
    const html = render({ audience: "owner", accountId: "acct_1", cause: "payment", locale: "es" });
    expect(html).toMatch(/<span lang="es">/);
    const text = renderedText(html);
    expect(text).toContain(m["billing.paused.client.payment.es"]);
    expect(text).toContain(m["billing.paused.client.action.es"]);
  });

  it("the AGENCY line is bilingual like the payment-failed banner's: its sentence and link in the resolved locale, under lang (design review M1) (mutation: keep the agency branch on m[...] → FAILS)", () => {
    const html = render({ audience: "agency", accountId: "acct_1", cause: "payment", locale: "es" });
    expect(html).toMatch(/<span lang="es">/);
    expect(renderedText(html).replace(/\s+/g, " ").trim())
      .toBe(`${m["billing.paused.agency.es"]} ${m["billing.paused.agencyAction.es"]}`);
  });

  it("on the Billing page itself the owner's sentence carries no \"Go to Billing\" link; on any other page it does (design review M2) (mutation: always render the link → FAILS)", () => {
    nav.pathname = "/dashboard/accounts/acct_1/billing";
    try {
      const html = render({ audience: "owner", accountId: "acct_1", cause: "payment", locale: "en" });
      expect(html).not.toContain("<a ");
      expect(renderedText(html)).not.toContain(m["billing.paused.client.action"]);
      expect(renderedText(html)).toContain(m["billing.paused.client.payment"]);
    } finally {
      nav.pathname = "/dashboard/accounts/acct_1/dashboard";
    }
    expect(render({ audience: "owner", accountId: "acct_1", cause: "payment", locale: "en" })).toContain('href="/dashboard/accounts/acct_1/billing"');
  });

  it("the member's Spanish sentence carries the staff line in Spanish too (mutation: leave the staff line untranslated → FAILS)", () => {
    const html = render({ audience: "member", accountId: "acct_1", cause: "ended", locale: "es" });
    const text = renderedText(html);
    expect(text).toContain(m["billing.paused.client.ended.es"]);
    expect(text).toContain(m["billing.paused.client.staff.es"]);
  });
});
