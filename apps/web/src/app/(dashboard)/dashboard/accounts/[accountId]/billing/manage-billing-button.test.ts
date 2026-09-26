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
/**
 * Code only: line and block comments (and so JSX comments) removed, string
 * and template contents kept. Copied from lib/history-state.test.ts, itself a
 * copy of packages/db/src/__tests__/cascade-export-boundary.test.ts: the
 * repo shares this scanner by copying it. Without it a source pin is
 * satisfied by a commented-out line (review of cd495636 proved it).
 */
function stripComments(src: string): string {
  let out = "";
  let mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; i++; continue; }
      if (c === "/" && d === "*") { mode = "block"; i++; continue; }
      if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      out += c;
      continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } continue; }
    if (mode === "block") {
      if (c === "*" && d === "/") { mode = "code"; i++; } else if (c === "\n") out += c;
      continue;
    }
    if (c === "\\") { out += c + (d ?? ""); i++; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) {
      mode = "code";
    }
    out += c;
  }
  return out;
}

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
  it("says a failure inline as an ALERT, so it is announced when it appears, in CODE, not in a comment (mutation: drop role=\"alert\" → FAILS; comment the line out, or leave it only in a comment → FAILS)", () => {
    const src = stripComments(readFileSync(path.join(here, "manage-billing-button.tsx"), "utf8"));
    expect(src).toContain('{state ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}');
  });
});
