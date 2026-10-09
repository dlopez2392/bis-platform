import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { LinkSiteCard } from "./link-site-card";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Code only: line and block comments (and so JSX comments) removed, string
 * and template contents kept. Copied from manage-billing-button.test.ts
 * (itself copied from lib/history-state.test.ts), which this file's D-056/
 * D-057 source pins reuse for the same reason: `testing` and `confirmText`
 * only change after a click, and this suite has no DOM to click in.
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

const src = stripComments(readFileSync(path.join(here, "link-site-card.tsx"), "utf8"));

const LINKED_PROPS = {
  projects: [{ id: "prj_1", name: "Rio Roofing site", domain: "rioroofing.com" }],
  projectsUnavailable: false,
  linked: { vercelProjectId: "prj_1", domain: "rioroofing.com" },
  daysStored: 12,
  saveAction: async () => ({ ok: true as const }),
  testAction: async () => ({ ok: true as const, visitors: 10, pageviews: 20 }),
  unlinkAction: async () => ({ ok: true as const, daysDeleted: 12 }),
};

describe("LinkSiteCard — Test connection button (D-056)", () => {
  it("is ghost, not outline (mutation: change variant back to \"outline\" → FAILS)", () => {
    const html = renderToStaticMarkup(createElement(LinkSiteCard, LINKED_PROPS));
    const btn = html.match(/<button[^>]*>Test connection<\/button>/)?.[0];
    expect(btn).toBeTruthy();
    expect(btn).toContain('data-variant="ghost"');
    expect(btn).not.toContain('data-variant="outline"');
  });

  it("shows its own word while running, never the Save button's \"Saving…\", in CODE (mutation: revert to common.saving → FAILS)", () => {
    expect(src).toContain('{testing ? m["website.link.testing"] : m["website.link.test"]}');
    expect(src).not.toMatch(/testing\s*\?\s*m\["common\.saving"\]/);
  });
});

describe("LinkSiteCard — Unlink confirmation (D-057, DESIGN.md rule 6)", () => {
  it("never uses the browser's plain confirm()", () => {
    expect(src).not.toMatch(/window\.confirm|[^.]confirm\(/);
  });

  it("gates the destructive Unlink button on typing the linked domain, in CODE (mutation: drop the typed check → FAILS)", () => {
    expect(src).toContain("confirmText.trim() !== linked.domain");
    // The disabled expression has to reach the real destructive button, not
    // just exist somewhere in the file.
    expect(src).toMatch(/disabled=\{unlinking \|\| confirmText\.trim\(\) !== linked\.domain\}/);
  });

  it("resets the typed text so a stale value cannot carry into the next open (mutation: drop a reset site → the next account's dialog can open pre-armed)", () => {
    expect(src.match(/setConfirmText\(""\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("does not render the confirm input before the dialog is ever opened", () => {
    const html = renderToStaticMarkup(createElement(LinkSiteCard, LINKED_PROPS));
    expect(html).not.toContain('id="unlink-confirm"');
  });
});
