import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { ManageBillingButton } from "./manage-billing-button";

const here = path.dirname(fileURLToPath(import.meta.url));
const open = async () => ({ ok: false as const, error: m["billing.page.portalFailed"] });

describe("ManageBillingButton", () => {
  it("renders the button and the help line it is given, nothing else, before any click (mutation: ignore `help` and print the card line → FAILS)", () => {
    const html = renderToStaticMarkup(createElement(ManageBillingButton, { open, help: m["billing.page.manageHelp.canceled"] }));
    const words = renderedText(html);
    expect(words).toContain(m["billing.page.manage"]);
    expect(words).toContain(m["billing.page.manageHelp.canceled"]);
    expect(words).not.toContain(m["billing.page.manageHelp"]);
    expect(words).not.toContain(m["billing.page.portalFailed"]);
  });

  /**
   * A SOURCE pin, not a render: the sentence appears only after the action
   * answers (useActionState), and this suite has no DOM to click in. What it
   * pins is that the failure is announced (role="alert") and said in the
   * destructive ink, so a screen reader hears it when it appears.
   */
  it("says a failure inline as an ALERT, so it is announced when it appears (mutation: drop role=\"alert\" → FAILS)", () => {
    const src = readFileSync(path.join(here, "manage-billing-button.tsx"), "utf8");
    expect(src).toContain('{state ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}');
  });
});
