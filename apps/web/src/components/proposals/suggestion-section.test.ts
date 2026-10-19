import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { renderedText } from "@/lib/rendered-text";
import { buildSuggestionView } from "@/lib/proposals/view";
import { SuggestionSection, SuggestionSectionSkeleton, type SuggestionSectionData } from "./suggestion-section";
import { CALL_AT, NAMES, NOW, PIPELINE_STAGES, STAGES, ZONE, rows } from "./suggestion-specimens";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const ok = async () => ({ ok: true as const, status: "accepted" as const, toast: "Done" });
const actions = { accept: ok, editAccept: ok, discard: ok, undo: async () => ({ ok: true as const, message: "Undone." }) };
function views(locale: Locale) {
  return [rows.pending, rows.stage].map((r) => buildSuggestionView(r, {
    tr: makeTr(locale), zone: ZONE, now: NOW, stages: STAGES, pipelineStages: PIPELINE_STAGES,
    callerName: "Ana Lopez", callStartedAt: CALL_AT, personaName: "Sofia", names: NAMES, viewerId: null,
  }));
}
function section(data: SuggestionSectionData, locale: Locale = "en") {
  return renderToStaticMarkup(createElement(SuggestionSection, { tr: makeTr(locale), personaName: "Sofia", data, ...actions }));
}
const loaded = (locale: Locale, capped = false): SuggestionSectionData => ({ ok: true, views: views(locale), capped });
const plain = (h: string) => renderedText(h).replace(/\s+/g, " ").trim();
/** The markup with every card (each <article>) cut out: what the section itself draws around them. */
const outsideCards = (h: string) => h.replace(/<article[\s\S]*?<\/article>/g, "");

describe("SuggestionSection: loaded", () => {
  it.each([
    ["en", "Suggestions", "From Sofia. Nothing changes until you accept."],
    ["es", "Sugerencias", "De Sofia. Nada cambia hasta que usted acepte."],
  ] as const)("%s: lang on the section, a mono-label h2, the subhead with the persona, and the cards", (locale, heading, subhead) => {
    const h = section(loaded(locale), locale);
    expect(h).toMatch(new RegExp(`^<section[^>]*lang="${locale}"`));
    expect(h).toMatch(new RegExp(`<h2[^>]*class="[^"]*font-mono[^"]*uppercase[^"]*"[^>]*>${heading}</h2>`));
    expect(plain(h)).toContain(subhead);
    expect((h.match(/<article\b/g) ?? []).length).toBe(2);
  });
  it("no element wraps the stack in a card (P12): the section draws no card of its own", () => {
    const around = outsideCards(section(loaded("en")));
    expect(around).not.toMatch(/rounded-\[var\(--radius-card\)\]|rounded-xl|bg-card|glass|shadow-\[var\(--shadow-card\)\]/);
  });
  it("capped says so, in both languages; not capped says nothing", () => {
    expect(plain(section(loaded("en", true)))).toContain("Showing the newest 200.");
    expect(plain(section(loaded("es", true), "es"))).toContain("Se muestran las 200 más recientes.");
    expect(plain(section(loaded("en", false)))).not.toContain("Showing the newest");
  });
});

describe("SuggestionSection: empty and error", () => {
  it("empty renders nothing", () => {
    expect(section({ ok: true, views: [], capped: false })).toBe("");
  });
  it.each([
    ["en", "Couldn't load suggestions.", "Retry"],
    ["es", "No se pudieron cargar las sugerencias.", "Intentar de nuevo"],
  ] as const)("%s: the error, a Retry button, and no cards", (locale, text, retry) => {
    const h = section({ ok: false }, locale);
    expect(plain(h)).toContain(text);
    expect(h).toMatch(new RegExp(`<button[^>]*type="button"[^>]*>${retry}</button>`));
    expect(h).not.toMatch(/<article\b/);
  });
});

describe("SuggestionSectionSkeleton: loading (rule 7)", () => {
  it.each([["en", "Loading suggestions…"], ["es", "Cargando sugerencias…"]] as const)(
    "%s: two skeleton cards shaped like the card, a status line, no spinner", (locale, text) => {
      const h = renderToStaticMarkup(createElement(SuggestionSectionSkeleton, { tr: makeTr(locale) }));
      expect((h.match(/data-skeleton/g) ?? []).length).toBe(2);
      expect(h).toMatch(new RegExp(`<p[^>]*role="status"[^>]*>${text}</p>`));
      expect(h).not.toMatch(/animate-spin|spinner|Loader/);
      expect(new Set(h.match(/rounded-[^\s"]+/g))).toEqual(new Set(["rounded-[var(--radius-card)]", "rounded-[var(--radius-ctl)]"]));
      expect(h).toMatch(/data-skeleton[^>]*class="[^"]*rounded-\[var\(--radius-card\)\]/);
    });
});

// CI run 39267488188 (phone-width.spec, /dashboard/styleguide at 375px): the page was 443px wide. 330px is
// the skeleton card's min-content exactly: three fixed-width button bars (80 + 112 + 80px, two 8px gaps)
// in a row that could not wrap, plus the card's 20px padding and border. A row of fixed widths must wrap,
// and the error row's words must be free to wrap beside Retry.
describe("SuggestionSection at phone width (no fixed row it cannot shrink below)", () => {
  it("the skeleton's button row wraps (mutation: drop flex-wrap -> FAILS)", () => {
    const h = renderToStaticMarkup(createElement(SuggestionSectionSkeleton, { tr: makeTr("en") }));
    const rows = [...h.matchAll(/<div class="([^"]*)"><div data-slot="skeleton"/g)].map((x) => x[1]!);
    expect(rows.length).toBe(2);
    for (const cls of rows) expect(cls.split(" ")).toEqual(expect.arrayContaining(["flex", "flex-wrap"]));
  });
  it("the error row wraps, and its sentence may shrink beside Retry (mutation: drop min-w-0 -> FAILS)", () => {
    const h = section({ ok: false });
    expect(h).toMatch(/<div role="alert" class="[^"]*\bflex-wrap\b[^"]*"><p class="[^"]*\bmin-w-0\b/);
  });
});

describe("SuggestionRetry (plan fix M6)", () => {
  it("re-reads the page with useRouter().refresh() from next/navigation, and nothing else", () => {
    const src = readFileSync(join(__dirname, "suggestion-retry.tsx"), "utf8");
    expect(src).toMatch(/^"use client";/);
    expect(src).toMatch(/import \{ useRouter \} from "next\/navigation";/);
    expect(src).toMatch(/router\.refresh\(\)/);
    expect(src).not.toMatch(/router\.(push|replace|back|forward)\(/);
  });
});
