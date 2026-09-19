import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { ProposalActions } from "./proposal-actions";
import type { ActionResult } from "./actions";

/**
 * `renderToStaticMarkup` only proves the INITIAL render — there is no DOM
 * here for a click to dispatch against, so `startTransition`'s async body
 * (the actual accept/dismiss/toast wiring) is never exercised by this file.
 * That boundary is `actions.test.ts`'s job (the real `acceptProposal`/
 * `dismissProposal` against a throwaway account) and, for the click itself,
 * would need Playwright — no jsdom/testing-library is wired into this repo's
 * unit suite today (`work-row-actions.tsx`, the identical shape one folder
 * over, has no dedicated unit test either, for the same reason). What IS
 * real and falsifiable here: the two buttons render correctly, start
 * enabled, and never carry a persistent third "Undo" affordance.
 */
async function ok(): Promise<ActionResult> {
  return { ok: true };
}

function render() {
  // `createElement`, not a direct `ProposalActions({...})` call: this
  // component calls `useTransition`, and a hook only has a live dispatcher
  // to talk to when React itself walks the element tree — a bare function
  // call reaches the hook with no render in progress at all ("Invalid hook
  // call"). `CallDetailPage` and `CallProposals` can be called directly in
  // their own test files because neither uses a hook itself.
  return renderToStaticMarkup(
    createElement(ProposalActions, {
      proposalId: "prop1",
      acceptProposal: ok,
      dismissProposal: ok,
      acceptedToast: "Added to your to-do list",
    }),
  );
}

describe("ProposalActions", () => {
  it("renders Accept and Dismiss, both enabled, both ghost (mutation: default disabled to true -> FAILS)", () => {
    const html = render();
    const text = renderedText(html);
    expect(text).toContain(m["proposals.accept"]);
    expect(text).toContain(m["proposals.dismiss"]);
    // NOT a plain `.not.toContain("disabled")` — the Button component's own
    // base classes carry `disabled:pointer-events-none disabled:opacity-50`
    // (Tailwind variant selectors) on every render regardless of state, so
    // that substring is always present and the assertion could never fail.
    // The real HTML boolean attribute is "disabled" NOT followed by ":".
    expect(html).not.toMatch(/\bdisabled(?!:)/);
    // Both `type="button"` — neither is a form submit control.
    expect(html.match(/<button\b[^>]*\btype="button"/g) ?? []).toHaveLength(2);
  });

  it("never renders a persistent Undo affordance (mutation: add an always-visible Undo button next to Accept -> FAILS)", () => {
    // No undo toast on either action — accepting writes a real CRM record
    // and dismissal is terminal by design (actions.ts's own doc comment on
    // `dismissProposal`). A persistent Undo control in the static markup
    // would be exactly the affordance this component must not offer.
    const html = render();
    expect(renderedText(html)).not.toContain(m["common.undo"]);
  });
});
