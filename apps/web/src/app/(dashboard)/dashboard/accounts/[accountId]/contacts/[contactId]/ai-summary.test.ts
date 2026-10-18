import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderedText } from "@/lib/rendered-text";
import { makeTr } from "@/lib/record/copy";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { AiSummaryView, AiSummary } = await import("./ai-summary");

const labels = (locale: "en" | "es") => {
  const tr = makeTr(locale);
  return { regenerate: tr.text("record.ai.regenerate"), retry: tr.text("record.card.retry"), failed: tr.text("record.ai.failed"), capped: tr.text("record.ai.capped"), writing: tr.text("record.ai.writing") };
};
const view = (v: Parameters<typeof AiSummaryView>[0]["view"], locale: "en" | "es" = "en") =>
  renderToStaticMarkup(createElement(AiSummaryView, { view: v, labels: labels(locale), onRegenerate: () => {}, onRetry: () => {} }));
const READY = { state: "ready" as const, text: "Booked for Tuesday.", generatedAt: "2026-10-18T14:42:00Z", language: "es" as const, stamp: "Generado por IA · 9:42 a.m." };

describe("the AI part's five states (spec 4.8; G11)", () => {
  it("loading and generating: a two-line skeleton and a screen-reader line, never a spinner (rule 7; mutation: render a spinner icon -> FAILS)", () => {
    for (const s of [{ state: "loading" as const }, { state: "generating" as const }]) {
      const html = view(s, "es");
      expect(html).toContain('data-state="loading"');
      expect(html.match(/data-record-skeleton/g)).toHaveLength(1);
      expect(html.match(/data-slot="skeleton"/g)).toHaveLength(2);
      expect(renderedText(html)).toContain("Escribiendo el resumen…");
      expect(html).not.toMatch(/animate-spin|lucide-loader/);
    }
  });
  it("ready: the paragraph with the cache's lang, the mono label, one ghost Regenerate (rule 8; mutations: drop lang -> FAILS; variant default -> FAILS)", () => {
    const html = view(READY, "es");
    expect(html).toMatch(/<p[^>]*lang="es"[^>]*data-ai-summary-text[^>]*>Booked for Tuesday\.<\/p>|<p[^>]*data-ai-summary-text[^>]*lang="es"[^>]*>Booked for Tuesday\.<\/p>/);
    expect(html).toMatch(/data-ai-summary-label[^>]*data-generated-at="2026-10-18T14:42:00Z"|data-generated-at="2026-10-18T14:42:00Z"[^>]*data-ai-summary-label/);
    expect(renderedText(html)).toContain("Generado por IA · 9:42 a.m.");
    expect(html.match(/data-ai-regenerate/g)).toHaveLength(1);
    expect(html).toMatch(/data-ai-regenerate[^>]*data-variant="ghost"|data-variant="ghost"[^>]*data-ai-regenerate/);
    expect(renderedText(html)).toContain("Volver a generar");
    expect(html).not.toContain("data-hero");
  });
  it("none: nothing at all (I13; mutation: render an empty wrapper -> FAILS)", () => {
    expect(view({ state: "none" })).toBe("");
  });
  it("capped: the plain note, in both languages (spec 4.6)", () => {
    // Deviation from the brief's literal text: renderedText replaces EVERY tag with a space
    // (rendered-text.ts:27), including the single root <p>'s own open/close tags, so a bare
    // `.toBe(...)` on a one-element tree always carries a leading and trailing space and could
    // never pass for ANY implementation — confirmed by running the brief's exact assertion first
    // (red: `expected ' AI summaries are paused until tomorrow. ' to be 'AI summaries are paused
    // until tomorrow.'`). `.trim()` here (not a change to the shared helper, which other specs
    // rely on NOT trimming mid-string) makes the assertion a real, passable check of the content.
    expect(renderedText(view({ state: "capped" }, "en")).trim()).toBe("AI summaries are paused until tomorrow.");
    expect(renderedText(view({ state: "capped" }, "es")).trim()).toBe("Los resúmenes con IA vuelven mañana.");
  });
  it("failed: its own words and a ghost Retry, role alert (rule 5; mutation: reuse the card's error -> FAILS)", () => {
    const html = view({ state: "failed" }, "es");
    expect(html).toContain('role="alert"');
    expect(renderedText(html)).toContain("No se pudo escribir el resumen ahora.");
    expect(renderedText(html)).toContain("Intentar de nuevo");
    expect(html.match(/data-ai-retry/g)).toHaveLength(1);
  });
  it("AiSummary starts as the skeleton and carries its route (mutation: start as none -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(AiSummary, { url: "/api/accounts/a/contacts/c/ai-summary?locale=es", labels: labels("en") }));
    expect(html).toContain('data-state="loading"');
    expect(html).toContain('data-ai-summary-url="/api/accounts/a/contacts/c/ai-summary?locale=es"');
  });
  it("the drawer never mounts it (spec 1, 7; mutation: import ./ai-summary in contact-drawer.tsx -> FAILS)", () => {
    const drawer = readFileSync(join(__dirname, "..", "contact-drawer.tsx"), "utf8");
    expect(drawer).not.toMatch(/ai-summary/);
  });
});
