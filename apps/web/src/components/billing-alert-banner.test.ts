import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BillingAlert } from "@bis/db";
import { BillingAlertBanner } from "./billing-alert-banner";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

const alert = (over: Partial<BillingAlert> & { accountId: string }): BillingAlert => ({
  accountName: over.accountId, kind: "paused", since: "2026-10-01T00:00:00.000Z", ...over,
});

const render = (alerts: BillingAlert[]) => renderToStaticMarkup(createElement(BillingAlertBanner, { alerts }));

describe("BillingAlertBanner", () => {
  it("renders nothing at zero (mutation: render an empty Notice shell -> FAILS)", () => {
    expect(render([])).toBe("");
  });

  it("names up to five accounts by link, then 'and N more' for the rest (mutation: drop the cap -> all seven names show, FAILS)", () => {
    const seven = Array.from({ length: 7 }, (_, i) => alert({ accountId: `a${i}`, accountName: `Account ${i}` }));
    const html = render(seven);
    for (let i = 0; i < 5; i++) {
      expect(html).toContain(`data-account-id="a${i}"`);
      expect(html).toContain(`>Account ${i}<`);
    }
    expect(html).not.toContain('data-account-id="a5"');
    expect(html).not.toContain('data-account-id="a6"');
    expect(renderedText(html)).toContain(m["work.agency.billing.more"].replace("{n}", "2"));
    for (const a of seven.slice(0, 5)) {
      expect(html).toContain(`href="/dashboard/accounts/${a.accountId}/settings#billing"`);
    }
  });

  it("one line per kind present, in the fixed order paused, paused 30+ days, payment failed, usage mismatch — regardless of the array's own order (mutation: render in array order -> FAILS)", () => {
    const html = render([
      alert({ accountId: "m1", kind: "usage_mismatch" }),
      alert({ accountId: "p1", kind: "payment_failed" }),
      alert({ accountId: "n1", kind: "paused_no_forward" }),
      alert({ accountId: "a1", kind: "paused" }),
    ]);
    const text = renderedText(html);
    const order = [
      m["work.agency.billing.paused"], m["work.agency.billing.pausedNoForward"],
      m["work.agency.billing.paymentFailed"], m["work.agency.billing.mismatch"],
    ].map((label) => text.indexOf(label));
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it("only the kinds present render a line (mutation: always render all four -> FAILS)", () => {
    const html = render([alert({ accountId: "p1", kind: "payment_failed" })]);
    const text = renderedText(html);
    expect(text).toContain(m["work.agency.billing.paymentFailed"]);
    expect(text).not.toContain(m["work.agency.billing.paused"]);
    expect(text).not.toContain(m["work.agency.billing.pausedNoForward"]);
    expect(text).not.toContain(m["work.agency.billing.mismatch"]);
  });

  it("tone is crit when any line is paused, paused 30+ days or a usage mismatch; warn when only payment failed shows (mutation: always warn -> FAILS; mutation: always crit -> FAILS)", () => {
    expect(render([alert({ accountId: "p1", kind: "payment_failed" })])).toContain('bg-[var(--warn-bg)]');
    expect(render([alert({ accountId: "a1", kind: "paused" })])).toContain('bg-[var(--crit-bg)]');
    expect(render([alert({ accountId: "n1", kind: "paused_no_forward" })])).toContain('bg-[var(--crit-bg)]');
    expect(render([alert({ accountId: "m1", kind: "usage_mismatch" })])).toContain('bg-[var(--crit-bg)]');
    // Mixed: payment_failed beside paused is still crit (any critical kind wins).
    expect(render([alert({ accountId: "p1", kind: "payment_failed" }), alert({ accountId: "a1", kind: "paused" })]))
      .toContain('bg-[var(--crit-bg)]');
  });

  it("is a standing fact, not an alert interrupting a screen reader (role=note, DESIGN rule 3's dot-and-word kin) (mutation: drop role=note -> FAILS)", () => {
    const html = render([alert({ accountId: "a1" })]);
    expect(html).toContain('role="note"');
    expect(html).not.toContain('role="alert"');
  });
});
