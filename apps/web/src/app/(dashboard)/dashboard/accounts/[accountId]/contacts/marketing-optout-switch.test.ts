import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";

// The switch imports the server action module; stubbed so this render never
// reaches `requireAccountAccess`/`dbForRequest` (nothing is clicked here).
vi.mock("./actions", () => ({ setMarketingEmailOptOutAction: vi.fn() }));

const { MarketingOptOutSwitch } = await import("./marketing-optout-switch");

const CHICAGO = { zone: "America/Chicago", guessed: false, label: "America/Chicago" };

function render(optedOutAt: string | null, zone: { zone: string; guessed: boolean; label: string } = CHICAGO) {
  return renderToStaticMarkup(createElement(MarketingOptOutSwitch, {
    accountId: "a1", contactId: "c1", optedOutAt, zone,
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

describe("MarketingOptOutSwitch: since when", () => {
  it("under a stamped switch, says since when, dated in the ACCOUNT's zone", () => {
    // 02:30 UTC on Sep 4 is the evening of Sep 3 in Chicago (the render's zone).
    const html = render("2026-09-04T02:30:00.000Z");
    expect(html).toContain(m["contact.marketingOptOut.since"].replace("{date}", "Sep 3, 2026"));
    expect(html).not.toContain("Sep 4, 2026");
    // The account's OWN zone is not a guess, so the line does not name it.
    expect(html).not.toContain("(America/Chicago)");
  });

  it("names the zone when the account's own could not be used (#123 m3)", () => {
    // renderZone fell back to UTC: 02:30 UTC on Sep 4 is printed as Sep 4, and
    // the line says so rather than passing it off as the account's local day.
    const html = render("2026-09-04T02:30:00.000Z", { zone: "UTC", guessed: true, label: "UTC" });
    expect(html).toContain("Off since Sep 4, 2026 (UTC)");
  });

  it("says nothing about since when while the switch is off", () => {
    expect(render(null)).not.toContain(m["contact.marketingOptOut.since"].replace("{date}", ""));
  });
});
