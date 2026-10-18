import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const {
  RequiredDocumentsSummary, requiredSummaryText, REQUIRED_DOCUMENTS_HASH, shouldOpenForHash,
} = await import("./required-documents-summary");
const { buildPaletteEntries } = await import("@/lib/palette/registry");

const noop = () => Promise.resolve({ ok: true as const, list: [] });
const noopUndo = () => Promise.resolve({ ok: true as const });

function render(required: string[] | null) {
  return renderToStaticMarkup(
    createElement(RequiredDocumentsSummary, { required: required as never, locale: "en", save: noop, undo: noopUndo }),
  );
}

describe("requiredSummaryText (spec 3.3's example)", () => {
  it("joins the stored order with a count (mutation: reverse the stored order -> FAILS)", () => {
    expect(requiredSummaryText(["id", "insurance"] as never, "en")).toBe("Required for every customer: ID, Insurance (2)");
    expect(requiredSummaryText(["id", "insurance"] as never, "es")).toBe("Requeridos para cada cliente: Identificación, Seguro (2)");
  });

  it("an empty list reads its own sentence", () => {
    expect(requiredSummaryText([], "en")).toBe("Nothing is required for every customer yet.");
  });
});

describe("the Required documents card (S-07 3a, spec 3.3)", () => {
  it("renders the collapsed summary line and the eight requirable checkboxes with exactly one primary (Save; rule 8)", () => {
    const html = render(["id", "insurance"]);
    expect(html).toContain('id="required-documents"');
    expect(html).toContain('data-required-documents');
    expect(renderedText(html)).toContain("Required for every customer: ID, Insurance (2)");
    expect(html.match(/role="checkbox"/g)).toHaveLength(8);
    expect(renderedText(html)).not.toContain("Other");
    expect(html.match(/role="checkbox"[^>]*data-state="checked"/g)).toHaveLength(2);
    expect(html.match(/data-variant="default"/g)).toHaveLength(1);
  });

  it("an empty required list reads its own sentence", () => {
    expect(renderedText(render([]))).toContain("Nothing is required for every customer yet.");
  });

  it("required: null fails on its own (rule 5): no picker, no primary (mutation: draw the picker -> FAILS)", () => {
    const html = render(null);
    expect(renderedText(html)).toContain("Couldn't load the required list.");
    expect(html).not.toContain('role="checkbox"');
    expect(html).not.toContain('data-variant="default"');
  });
});

describe("the collapsed card opens itself for #required-documents (review M9)", () => {
  it("shouldOpenForHash", () => {
    expect(shouldOpenForHash(REQUIRED_DOCUMENTS_HASH)).toBe(true);
    expect(shouldOpenForHash("")).toBe(false);
    expect(shouldOpenForHash("#documents")).toBe(false);
  });

  it("the palette's Owner entry and this constant name the same hash (mutation: rename either -> FAILS)", () => {
    const entries = buildPaletteEntries("/dashboard/accounts/a1", false, true);
    const entry = entries.find((e) => e.id === "nav:required-documents");
    expect(entry).toBeDefined();
    const hash = `#${(entry as { href: string }).href.split("#")[1]}`;
    expect(hash).toBe(REQUIRED_DOCUMENTS_HASH);
  });

  it("the source opens the details on a matching hash via a ref, never state (mutation: drop the ref, the check, or the listener -> FAILS)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = stripComments(readFileSync(path.join(here, "required-documents-summary.tsx"), "utf8"));
    expect(src).toContain("<details ref={details}>");
    expect(src).toContain("if (details.current && shouldOpenForHash(window.location.hash)) details.current.open = true;");
    expect(src).toContain('window.addEventListener("hashchange", onHash);');
  });
});

/** Code only: line and block comments removed, strings kept (technician-guards.test.ts's scanner). */
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
