import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: unknown; className?: string }) =>
    createElement("a", { href, className }, children as never),
}));
const { BillingBanner } = await import("./billing-banner");
const render = (audience: "client" | "agency") => renderToStaticMarkup(createElement(BillingBanner, { audience, accountId: "acct_1" }));

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

  it("tells the AGENCY, inside that account, and links to the Billing card (mutation: show the client sentence to the agency → FAILS)", () => {
    const html = render("agency");
    expect(renderedText(html).replace(/\s+/g, " ").trim()).toBe(`${m["billing.banner.agency"]} ${m["billing.banner.agencyAction"]}`);
    expect(html).toContain('href="/dashboard/accounts/acct_1/settings#billing"');
  });

  it("is a standing note, not an alert, and never colour alone (rule 3): the sentence is the marker (mutation: role=alert → announced on every navigation, FAILS)", () => {
    const html = render("client");
    expect(html).toContain('role="note"');
    expect(renderedText(html)).toContain(m["billing.banner.client"]);
  });
});
