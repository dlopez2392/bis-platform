import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BILLING_STATUS_TREATMENTS, type BillingStatus } from "@/lib/billing/billing-view";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

const { BillingCardStates } = await import("./billing-card-states");
const here = path.dirname(fileURLToPath(import.meta.url));

describe("styleguide: the agency Billing card", () => {
  it("shows the REAL card in all seven status words, plus its loading and error states, and the page mounts it (DESIGN definition of done) (mutation: drop a state's demo → FAILS; unmount the section → FAILS)", () => {
    const html = renderToStaticMarkup(createElement(BillingCardStates));
    const shown = new Set([...html.matchAll(/data-status="([a-z_]+)"/g)].map((x) => x[1]));
    expect([...shown].sort()).toEqual((Object.keys(BILLING_STATUS_TREATMENTS) as BillingStatus[]).sort());
    expect(html).toContain('aria-busy="true"');
    expect(renderedText(html)).toContain(m["billing.card.error"]);
    expect(renderedText(html)).toContain(m["billing.card.noPlans"]);
    expect(renderedText(html)).toContain(m["billing.card.noStripe"]);
    expect(readFileSync(path.join(here, "page.tsx"), "utf8")).toMatch(/<BillingCardStates\s*\/>/);
  });
});
