import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { SetupVettingNotice } from "./setup-vetting-notice";

const render = (trade: string | null) => renderToStaticMarkup(createElement(SetupVettingNotice, { accountId: "a1", trade }));

describe("SetupVettingNotice (S-53)", () => {
  it("no trade: asks for it and links to the Settings Trade card (mutation: drop the link -> FAILS)", () => {
    const html = render(null);
    // renderedText, not the raw html, because React escapes the apostrophe
    // in "company's" to `&#x27;` (lib/rendered-text.ts's own doc comment).
    expect(renderedText(html)).toContain(m["vetting.sofia.noTrade"]);
    expect(html).toContain('href="/dashboard/accounts/a1/settings?from=setup#trade"');
    expect(renderedText(html)).toContain(m["vetting.sofia.noTradeLink"]);
  });
  it("a CRM-only trade: says Sofía and the web chat are not available", () => {
    expect(renderedText(render("restaurant"))).toContain(m["vetting.crmOnlyCreated"]);
  });
  it("an allowed trade: renders nothing", () => {
    expect(render("hvac")).toBe("");
  });
});
