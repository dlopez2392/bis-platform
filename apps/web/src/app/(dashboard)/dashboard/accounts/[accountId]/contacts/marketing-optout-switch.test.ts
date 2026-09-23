import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";

// The switch imports the server action module; stubbed so this render never
// reaches `requireAccountAccess`/`dbForRequest` (nothing is clicked here).
vi.mock("./actions", () => ({ setMarketingEmailOptOutAction: vi.fn() }));

const { MarketingOptOutSwitch } = await import("./marketing-optout-switch");

function render(optedOutAt: string | null) {
  return renderToStaticMarkup(createElement(MarketingOptOutSwitch, {
    accountId: "a1", contactId: "c1", optedOutAt,
  }));
}

/** The one checkbox's own opening tag (Radix renders it as a `button`
 *  with role="checkbox"). */
function checkbox(html: string): string {
  const tag = /<button[^>]*role="checkbox"[^>]*>/.exec(html)?.[0];
  if (!tag) throw new Error(`no checkbox in: ${html}`);
  return tag;
}

describe("MarketingOptOutSwitch", () => {
  it("renders CHECKED when the contact carries an opt-out stamp", () => {
    expect(checkbox(render("2026-09-23T12:00:00.000Z"))).toContain('aria-checked="true"');
  });

  it("renders unchecked when the stamp is null (may receive marketing email)", () => {
    expect(checkbox(render(null))).toContain('aria-checked="false"');
  });

  it("labels the box and describes it with the hint", () => {
    const html = render(null);
    const box = checkbox(html);
    const id = /\sid="([^"]+)"/.exec(box)?.[1];
    const describedBy = /aria-describedby="([^"]+)"/.exec(box)?.[1];
    expect(id).toBeTruthy();
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`for="${id}"`);
    expect(html).toContain(m["contact.marketingOptOut.label"]);
    // The hint is the element the checkbox points at, and it says what the
    // switch holds back and what it does not.
    const hint = new RegExp(`<p[^>]*id="${describedBy}"[^>]*>([^<]*)</p>`).exec(html)?.[1];
    expect(hint).toBe(m["contact.marketingOptOut.hint"].replace(/'/g, "&#x27;"));
  });
});
