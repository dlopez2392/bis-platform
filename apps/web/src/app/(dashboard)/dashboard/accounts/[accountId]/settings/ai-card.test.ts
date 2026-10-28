import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("./ai-actions", () => ({}));

const { AiCard, AiCardSkeleton, AiCardError, AiGlobalConfirmForm, confirmMatches } = await import("./ai-card");

const VIEW: { accountEnabled: boolean; budgetDollars: string; globalEnabled: boolean; spendLine: string | null; reachedLine: string | null; skippedLine: string | null; summariesLine: string | null } =
  { accountEnabled: true, budgetDollars: "10", globalEnabled: true, spendLine: null, reachedLine: null, skippedLine: null, summariesLine: null };
const noop = async () => ({ ok: false as const, error: "aiSettings.error.failed" as const });
const card = (view: Partial<typeof VIEW>, locale: "en" | "es" = "en") =>
  renderToStaticMarkup(createElement(AiCard, { view: { ...VIEW, ...view }, locale, save: noop, undo: noop, setGlobal: noop }));
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the AI card (spec 3.6; DESIGN.md rules 1, 5, 6, 7, 8)", () => {
  it("empty: one sentence, no spend line, in both languages, with lang set (mutation: render spendLine ?? '' -> FAILS)", () => {
    const en = card({});
    expect(count(en, "data-ai-empty"), "one empty line").toBe(1);
    expect(count(en, "data-ai-spend")).toBe(0);
    expect(renderedText(en)).toContain("No AI use yet this month.");
    const es = card({}, "es");
    expect(renderedText(es)).toContain("Todavía no hay uso de IA este mes.");
    expect(es).toContain('lang="es"');
  });

  it("loaded: the spend, reached and skipped lines it is given, each in its own marker (mutation: drop the reached Notice -> FAILS)", () => {
    const html = card({ spendLine: "$1.84 of $10.00 this month, estimated", reachedLine: "Budget reached. Summaries, cards and suggestions are paused for this account until Nov 1.", skippedLine: "One of them was skipped this month because this account's AI was off or over budget." });
    expect([count(html, "data-ai-spend"), count(html, "data-ai-reached"), count(html, "data-ai-skipped"), count(html, "data-ai-empty")]).toEqual([1, 1, 1, 0]);
    expect(renderedText(html)).toContain("$1.84 of $10.00 this month, estimated");
  });

  it("the day's summaries line renders under the spend line when present, never when null (mutation: drop the line -> FAILS; render it always -> the null case FAILS)", () => {
    const withLine = card({ spendLine: "$0.01 of $10.00 this month, estimated", summariesLine: "3 of 200 customer summaries written today" });
    expect(withLine).toMatch(/data-ai-summaries[^>]*>3 of 200 customer summaries written today</);
    expect(withLine.indexOf("data-ai-summaries")).toBeGreaterThan(withLine.indexOf("data-ai-spend"));
    expect(card({ spendLine: "$0.01 of $10.00 this month, estimated" })).not.toContain("data-ai-summaries");
  });

  it("exactly one primary button, Save; the global switch is outline (rule 8; mutation: global button variant default -> FAILS)", () => {
    const html = card({});
    expect(count(html, 'data-variant="default"')).toBe(1);
    expect(html).toMatch(/data-ai-save[^>]*>|<button[^>]*data-variant="default"[^>]*data-ai-save/);
  });

  it("the global switch says what clicking does, both ways (mutation: one label for both states -> FAILS)", () => {
    expect(renderedText(card({ globalEnabled: true }))).toContain("Turn off everywhere");
    const off = card({ globalEnabled: false });
    expect(renderedText(off)).toContain("Turn on everywhere");
    expect(renderedText(off)).toContain("Off in every account: no summaries, cards or suggestions until you turn it back on. Sofía still answers calls, and every account's website chat still runs.");
    expect([count(off, "data-ai-global-on"), count(off, "data-ai-global-off")]).toEqual([1, 0]);
  });

  it("the stored switch and budget fill the form", () => {
    const html = card({ accountEnabled: false, budgetDollars: "25" });
    expect(html).toMatch(/data-ai-budget[^>]*value="25"|value="25"[^>]*data-ai-budget/);
    expect(html).toMatch(/data-ai-account[^>]*data-state="unchecked"|data-state="unchecked"[^>]*data-ai-account/);
  });
});

describe("the typed word (rule 6, choice I12)", () => {
  it("confirmMatches: the reader's word, trimmed, any case (mutation: case-sensitive -> FAILS)", () => {
    expect([confirmMatches(" off ", "OFF"), confirmMatches("OF", "OFF"), confirmMatches("apagar", "APAGAR")]).toEqual([true, false, true]);
  });
  const form = (typed: string, locale: "en" | "es" = "en") => renderToStaticMarkup(createElement(AiGlobalConfirmForm, {
    word: locale === "es" ? "APAGAR" : "OFF", typed, busy: false, locale, onTyped: () => {}, onCancel: () => {}, onConfirm: () => {},
  }));
  it("the destructive confirm stays disabled until the word matches (mutation: never disabled -> FAILS)", () => {
    // The real attribute `disabled` (vs. Tailwind's `disabled:` variant classes, present on the button either way).
    const DISABLED = /<button[^>]*data-ai-confirm-off[^>]*\bdisabled(?!:)|<button[^>]*\bdisabled(?!:)[^>]*data-ai-confirm-off/;
    expect(form("")).toMatch(DISABLED);
    expect(form("off")).not.toMatch(DISABLED);
  });
  it("says what it does and which word, in both languages", () => {
    expect(renderedText(form(""))).toContain("Every account loses call summaries, call cards, suggestions and customer summaries until this is turned back on. Sofía's calls and the website chat are not affected. Type OFF to confirm.");
    expect(renderedText(form("", "es"))).toContain("Todas las cuentas pierden los resúmenes de llamada, las tarjetas de llamada, las sugerencias y los resúmenes de clientes hasta que esto se vuelva a encender. Las llamadas de Sofía y el chat del sitio no se ven afectados. Escriba APAGAR para confirmar.");
  });
});

describe("loading and failing on its own (rules 5, 7)", () => {
  it("the skeleton is shaped like the card, busy, never a spinner (mutation: add animate-spin -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(AiCardSkeleton));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('id="ai"');
    expect(html).not.toContain("animate-spin");
  });
  it("the error card says so in the reader's language and keeps the anchor", () => {
    const es = renderToStaticMarkup(createElement(AiCardError, { locale: "es" }));
    expect(renderedText(es)).toContain("La configuración de IA no se pudo cargar ahora. El resto de la configuración sigue funcionando.");
    expect([count(es, 'id="ai"'), count(es, "data-ai-error")]).toEqual([1, 1]);
  });
});
