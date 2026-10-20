import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Proposal } from "@bis/db/proposal-rules";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { renderedText } from "@/lib/rendered-text";
import { buildSuggestionView } from "@/lib/proposals/view";
import { SuggestionRow, WaitingSuggestions, type WaitingData } from "./suggestion-row";
import { WaitingSuggestionsSkeleton } from "./waiting-skeleton";
import { CALL_AT, FIVE, NAMES, NOW, PIPELINE_STAGES, STAGES, TITLE, ZONE, rows } from "./suggestion-specimens";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

/**
 * The record's flat suggestion row and its "Waiting for you" section (item 8b-2, spec 5.3). Flat: inside the
 * What's next card it is rows split by --row-line rules, never a glass card inside the glass card (DESIGN.md
 * record page and drawer), and no primary at all (rule 8 as amended 2026-10-19).
 */
const ok = async () => ({ ok: true as const, status: "accepted" as const, toast: "Done" });
const actions = { accept: ok, editAccept: ok, discard: ok, undo: async () => ({ ok: true as const, message: "Undone." }) };
function view(row: Proposal, locale: Locale = "en", persona = "Lupe") {
  return buildSuggestionView(row, {
    tr: makeTr(locale), zone: ZONE, now: NOW, stages: STAGES, pipelineStages: PIPELINE_STAGES,
    callerName: null, callStartedAt: CALL_AT, personaName: persona, names: NAMES, viewerId: null,
  });
}
const rowHtml = (row: Proposal, locale: Locale = "en") =>
  renderToStaticMarkup(createElement(SuggestionRow, { view: view(row, locale), ...actions }));
function waiting(data: WaitingData, locale: Locale = "en") {
  return renderToStaticMarkup(createElement(WaitingSuggestions, {
    tr: makeTr(locale), data, seeAllHref: "/dashboard/accounts/acc_1/tasks", ...actions,
  }));
}
const plain = (h: string) => renderedText(h).replace(/\s+/g, " ").trim();
const buttons = (h: string) => h.match(/<button[^>]*>.*?<\/button>/g) ?? [];
const variant = (b: string) => /data-variant="([a-z]+)"/.exec(b)?.[1];
const CARD_LOOK = /rounded-\[var\(--radius-card\)\]|rounded-xl|bg-card|(?<![-\w])glass(?![-\w])|shadow-\[var\(--shadow-card\)\]/;

describe("SuggestionRow: what a row says", () => {
  it("the change, the evidence in its own lang, the persona's mark and the status as dot and word", () => {
    const h = rowHtml(rows.pending);
    expect(h).toMatch(/^<li[^>]*data-suggestion="sg_pending"[^>]*data-status="pending"/);
    expect(h).toContain(`<span lang="en">${TITLE}</span>`);
    expect(h).toMatch(/<q lang="en"[^>]*>Can someone call me back about the quote next week\?<\/q>/);
    expect(h).toMatch(/<span[^>]*data-ai-mark[^>]*>Lupe · AI<\/span>/);
    expect(h).toMatch(/<span[^>]*data-status-dot[^>]*><\/span><span[^>]*data-status-word[^>]*>Suggested<\/span>/);
  });
  it("Spanish: lang on the row, the Spanish words, the caller's words keep their own lang", () => {
    const h = rowHtml(rows.spanishEvidence, "es");
    expect(h).toMatch(/^<li[^>]*lang="es"/);
    expect(h).toMatch(/<q lang="es"[^>]*>¿Me puede llamar el jueves\?<\/q>/);
    expect(plain(h)).toContain("Lupe · IA");
    expect(plain(h)).toContain("Sugerida");
  });
  it("every state shows its word; only a pending row has buttons", () => {
    for (const s of FIVE) {
      const h = rowHtml(rows[s]);
      expect(h).toMatch(/data-status-word[^>]*>[^<]+</);
      expect(buttons(h).length).toBe(s === "pending" ? 2 : 0);
    }
  });
});

describe("SuggestionRow: flat, ghost only (rule 8, DESIGN.md record page)", () => {
  it("zero primary buttons and exactly two ghost ones, Accept and Discard (mutation: render the card's actions -> FAILS)", () => {
    const b = buttons(rowHtml(rows.pending));
    expect(b.map((x) => [x.replace(/<[^>]*>/g, ""), variant(x)])).toEqual([["Accept", "ghost"], ["Discard", "ghost"]]);
  });
  it("never a glass card: no card radius, no bg-card, no glass, a --row-line rule instead (mutation: SUGGESTION_CARD on the row -> FAILS)", () => {
    const h = rowHtml(rows.pending);
    expect(h).not.toMatch(CARD_LOOK);
    expect(h).toMatch(/^<li[^>]*class="[^"]*border-\[var\(--row-line\)\]/);
  });
  it("no hex colour anywhere in a row", () => {
    expect(rowHtml(rows.pending)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("WaitingSuggestions: the section inside What's next", () => {
  const two = (locale: Locale = "en"): WaitingData => ({ ok: true, views: [view(rows.pending, locale), view(rows.field, locale)] });
  it.each([
    ["en", "Waiting for you", "Edit or see all in To do"],
    ["es", "Esperan su respuesta", "Editar o ver todas en Pendientes"],
  ] as const)("%s: lang on the section, a mono-label heading, the rows, then the link to the tray", (locale, heading, seeAll) => {
    const h = waiting(two(locale), locale);
    expect(h).toMatch(new RegExp(`^<section[^>]*lang="${locale}"`));
    expect(h).toMatch(new RegExp(`<h3[^>]*class="[^"]*font-mono[^"]*uppercase[^"]*"[^>]*>${heading}</h3>`));
    expect((h.match(/<li[^>]*data-suggestion=/g) ?? []).length).toBe(2);
    expect(h).toMatch(new RegExp(`<a[^>]*href="/dashboard/accounts/acc_1/tasks"[^>]*>${seeAll}</a>`));
    expect(h.indexOf("<ul")).toBeLessThan(h.indexOf('href="/dashboard/accounts/acc_1/tasks"'));
  });
  it("no primary anywhere in the section, and no card inside the card", () => {
    const h = waiting(two());
    expect(h).not.toMatch(/data-variant="default"/);
    expect(h).not.toMatch(CARD_LOOK);
  });
  it("the section is the list the focus rule reads (data-suggestion-list)", () => {
    expect(waiting(two())).toMatch(/^<section(?=[^>]*data-suggestion-list)(?=[^>]*data-waiting-suggestions)/);
  });
  // Design review I3: the record's last (or only) Waiting row leaves, and the section with it: focus goes to
  // What's next's own heading, then the page's, never <body>.
  it("its last row falls back to What's next's heading, then the page's (mutation: no data-focus-fallback -> FAILS)", () => {
    expect(waiting(two())).toMatch(/^<section[^>]*data-focus-fallback="\[data-record-card=&quot;next-up&quot;\] h2\|h1"/);
  });
  // Design review minor 4: its heading id is a prop, so two copies on one page (the styleguide) differ.
  it("headingId names the heading the section is labelled by (mutation: a fixed id -> FAILS)", () => {
    const h = renderToStaticMarkup(createElement(WaitingSuggestions, {
      tr: makeTr("es"), data: two("es"), seeAllHref: "/dashboard/accounts/acc_1/tasks", headingId: "waiting-suggestions-es", ...actions,
    }));
    expect(h).toMatch(/^<section[^>]*aria-labelledby="waiting-suggestions-es"/);
    expect(h).toContain('<h3 id="waiting-suggestions-es"');
  });
  // Design review minor 2: the error line reads as the tray's does (text-foreground), not muted.
  it("the error sentence is text-foreground, as the tray's (mutation: text-muted-foreground -> FAILS)", () => {
    const cls = (/<div role="alert"[^>]*><p class="([^"]*)"/.exec(waiting({ ok: false })))?.[1] ?? "";
    expect(cls.split(" ")).toContain("text-foreground");
    expect(cls.split(" ")).not.toContain("text-muted-foreground");
  });
  it("empty: nothing at all (the card's own empty state stands)", () => {
    expect(waiting({ ok: true, views: [] })).toBe("");
  });
  it.each([["en", "Couldn't load suggestions.", "Retry"], ["es", "No se pudieron cargar las sugerencias.", "Intentar de nuevo"]] as const)(
    "%s: error: one line with Retry, no rows (mutation: render nothing on error -> FAILS)", (locale, words, retry) => {
      const h = waiting({ ok: false }, locale);
      expect(plain(h)).toContain(words);
      expect(h).toMatch(new RegExp(`<div role="alert"[^>]*>[\\s\\S]*<button[^>]*>${retry}</button>`));
      expect(h).not.toMatch(/data-suggestion=/);
    });
  it("the link is a tap-sized text link (min-h-11 md:min-h-8)", () => {
    const cls = (/<a[^>]*class="([^"]*)"[^>]*href="\/dashboard\/accounts\/acc_1\/tasks"|<a[^>]*href="\/dashboard\/accounts\/acc_1\/tasks"[^>]*class="([^"]*)"/
      .exec(waiting(two())) ?? []).slice(1).join(" ").split(" ");
    expect(cls).toEqual(expect.arrayContaining(["min-h-11", "md:min-h-8"]));
  });
});

describe("WaitingSuggestionsSkeleton (rule 7)", () => {
  it("two flat skeleton rows, no card, no spinner", () => {
    const h = renderToStaticMarkup(createElement(WaitingSuggestionsSkeleton));
    expect((h.match(/data-waiting-skeleton-row/g) ?? []).length).toBe(2);
    expect(h).not.toMatch(/animate-spin|spinner/i);
    expect(h).not.toMatch(CARD_LOOK);
  });
});
