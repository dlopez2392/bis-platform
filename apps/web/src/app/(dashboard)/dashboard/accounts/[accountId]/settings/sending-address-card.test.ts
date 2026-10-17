import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
import { SendingAddressCard } from "./sending-address-card";
import { renderedText } from "@/lib/rendered-text";

const html = (replies: { mode: "off" | "bis" | "own_domain"; domain: string | null }) => renderToStaticMarkup(createElement(SendingAddressCard, {
  fromEmail: null, action: vi.fn(), replies, setReplies: vi.fn(), checkDns: vi.fn(),
}));

describe("the Replies row (spec 'Turning it on'; plan G7)", () => {
  it("shows the state as a dot and a word, and the three choices (mutation: drop the dot → FAILS)", () => {
    const h = html({ mode: "bis", domain: null });
    expect(h).toContain('data-replies-state="bis"');
    expect(h).toMatch(/data-replies-state="bis"[^>]*>\s*<span[^>]*data-dot/);
    expect(renderedText(h)).toContain("Replies");
    expect(renderedText(h)).toContain("BIS address");
    expect(renderedText(h)).toContain("Customers reply to an address at reply.bis-rgv.com, and the reply lands on their thread here.");
    for (const v of ["off", "bis", "own_domain"]) expect(h).toContain(`value="${v}"`);
  });

  it("the card keeps ONE primary: Save; Check DNS is ghost (rule 8; mutation: Check DNS as default → two, FAILS)", () => {
    const h = html({ mode: "own_domain", domain: "reply.rio.com" });
    expect(h.match(/data-variant="default"/g)).toHaveLength(1);
    expect(renderedText(h)).toContain("Check DNS");
    expect(renderedText(h)).toContain("Customers reply to an address at reply.rio.com, and the reply lands on their thread here.");
  });

  it("off reads Off with the old behaviour's sentence (mutation: show the BIS sentence for off → FAILS)", () => {
    expect(renderedText(html({ mode: "off", domain: null }))).toContain("Customers' replies go to the reply-to address on Branding.");
  });
});

describe("the Never record slot (S-06 part 2; spec 'The Never record list')", () => {
  const withSlot = () => renderToStaticMarkup(createElement(SendingAddressCard, {
    fromEmail: null, action: vi.fn(), replies: { mode: "bis", domain: null }, setReplies: vi.fn(), checkDns: vi.fn(),
    neverLog: createElement("p", { "data-x": "1" }),
  }));

  it("renders AFTER the Replies row and OUTSIDE the form (mutation: render the slot inside the form → FAILS)", () => {
    const h = withSlot();
    const slot = h.indexOf('data-x="1"');
    expect(slot).toBeGreaterThan(-1);
    expect(slot).toBeGreaterThan(h.indexOf("</form>"));
    expect(slot).toBeGreaterThan(h.indexOf("data-replies-state"));
  });

  it("the card still has exactly ONE default-variant button, Save (rule 8)", () => {
    expect(withSlot().match(/data-variant="default"/g)).toHaveLength(1);
  });

  it("renders nothing extra when no slot is passed", () => {
    expect(html({ mode: "bis", domain: null })).not.toContain('data-x="1"');
  });
});
