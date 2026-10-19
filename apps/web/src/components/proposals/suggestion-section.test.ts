import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { renderedText } from "@/lib/rendered-text";
import { buildSuggestionView } from "@/lib/proposals/view";
import {
  SuggestionSection, SuggestionSectionSkeleton, AgencySuggestionSection, type SuggestionSectionData, type AgencySuggestionData,
} from "./suggestion-section";
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

/**
 * The tray grouped (item 8b-2, spec 5.1): a mono-label <h3> per group over its cards, and a heading is a
 * label, never a card around cards (P12).
 */
describe("SuggestionSection: grouped", () => {
  function grouped(locale: Locale = "en", capped = false): SuggestionSectionData {
    const [a, b] = views(locale);
    return { ok: true, capped, groups: [
      { key: "con_1:call:call_1", heading: "Ana López · from the call on Wed, Oct 14", views: [a!] },
      { key: "none:call:call_2", heading: "No customer yet · from the call on Tue, Oct 13", views: [b!] },
    ] };
  }
  it("each group is a mono-label <h3> over its cards, in the groups' order, under the section's <h2>", () => {
    const h = section(grouped());
    const heads = [...h.matchAll(/<h3[^>]*class="([^"]*)"[^>]*>([^<]*)<\/h3>/g)];
    expect(heads.map((x) => x[2])).toEqual(["Ana López · from the call on Wed, Oct 14", "No customer yet · from the call on Tue, Oct 13"]);
    for (const x of heads) expect(x[1]!.split(" ")).toEqual(expect.arrayContaining(["font-mono", "uppercase", "text-[10px]"]));
    expect(h.indexOf("<h2")).toBeLessThan(h.indexOf("<h3"));
    // Each heading sits directly before its own group's card.
    expect(h).toMatch(/Wed, Oct 14<\/h3><article[^>]*data-suggestion="sg_pending"/);
    expect(h).toMatch(/Tue, Oct 13<\/h3><article[^>]*data-suggestion="sg_stage"/);
  });
  it("no element wraps a group's cards in a card (P12; mutation: give the group a bg-card glass box -> FAILS)", () => {
    const around = outsideCards(section(grouped()));
    expect(around).not.toMatch(/rounded-\[var\(--radius-card\)\]|rounded-xl|bg-card|glass|shadow-\[var\(--shadow-card\)\]/);
    expect(around).toMatch(/data-suggestion-group="con_1:call:call_1"/);
  });
  it("one primary per card across the groups (rule 8)", () => {
    const h = section(grouped());
    for (const card of h.match(/<article[\s\S]*?<\/article>/g) ?? []) {
      expect((card.match(/data-variant="default"/g) ?? []).length).toBe(1);
    }
  });
  it("the section is the list the focus rule reads (data-suggestion-list), lang on the section; the cap line stays", () => {
    const h = section(grouped("es", true), "es");
    expect(h).toMatch(/^<section[^>]*data-suggestion-list[^>]*>|^<section(?=[^>]*data-suggestion-list)/);
    expect(h).toMatch(/^<section[^>]*lang="es"/);
    expect(plain(h)).toContain("Se muestran las 200 más recientes.");
  });
  it("no groups at all is no section, as no views is", () => {
    expect(section({ ok: true, capped: false, groups: [] })).toBe("");
  });
});

/**
 * The agency Work page's suggestions (item 8b-2, spec 5.2): one <section> per account, the account's brand
 * name as its mono heading, that account's groups as in the tray, the per-account cap line, and each
 * account's own bound actions.
 */
describe("AgencySuggestionSection", () => {
  const acceptA = vi.fn(ok);
  const acceptB = vi.fn(ok);
  function agency(data: AgencySuggestionData, locale: Locale = "en") {
    return renderToStaticMarkup(createElement(AgencySuggestionSection, { tr: makeTr(locale), data }));
  }
  function two(locale: Locale = "en"): AgencySuggestionData {
    const [a, b] = views(locale);
    return { ok: true, accounts: [
      { accountId: "acc_a", brandName: "Acme HVAC", personaName: "Lupe", capped: true,
        groups: [{ key: "k1", heading: "Ana López · from the call on Wed, Oct 14", views: [a!] }],
        actions: { ...actions, accept: acceptA } },
      { accountId: "acc_b", brandName: "Rio Roofing", personaName: "Sofía", capped: false,
        groups: [{ key: "k2", heading: "No customer yet · from the call on Wed, Oct 14", views: [b!] }],
        actions: { ...actions, accept: acceptB } },
    ] };
  }
  const accountSections = (h: string) => [...h.matchAll(/<section[^>]*data-suggestion-account="([^"]+)"[\s\S]*?<\/section>/g)];
  it("one section per account, headed by its brand name in a mono label, each with its own persona's subhead", () => {
    const h = agency(two());
    const s = accountSections(h);
    expect(s.map((x) => x[1])).toEqual(["acc_a", "acc_b"]);
    expect(s[0]![0]).toMatch(/<h3[^>]*class="[^"]*font-mono[^"]*"[^>]*>Acme HVAC<\/h3>/);
    expect(s[1]![0]).toMatch(/<h3[^>]*>Rio Roofing<\/h3>/);
    expect(plain(s[0]![0])).toContain("From Lupe. Nothing changes until you accept.");
    expect(plain(s[1]![0])).toContain("From Sofía. Nothing changes until you accept.");
    // A group heading under an account heading is one level down.
    expect(s[0]![0]).toMatch(/<h4[^>]*>Ana López · from the call on Wed, Oct 14<\/h4>/);
  });
  it("the capped account says so; the other does not (mutation: drop the cap line -> FAILS)", () => {
    const [a, b] = accountSections(agency(two()));
    expect(plain(a![0])).toContain("Showing the newest 50 for this account.");
    expect(plain(b![0])).not.toContain("Showing the newest");
    const es = accountSections(agency(two("es"), "es"));
    expect(plain(es[0]![0])).toContain("Se muestran las 50 más recientes de esta cuenta.");
  });
  it("each card is a full card with one primary, never a link row (rule 8; the old read-only rows are gone)", () => {
    const h = agency(two());
    const cards = h.match(/<article[\s\S]*?<\/article>/g) ?? [];
    expect(cards).toHaveLength(2);
    for (const c of cards) expect((c.match(/data-variant="default"/g) ?? []).length).toBe(1);
    expect(h).not.toContain("#call-proposals");
  });
  it("each account section is its own focus list (data-suggestion-list) and no card wraps a section", () => {
    const h = agency(two());
    for (const s of accountSections(h)) expect(s[0]).toMatch(/^<section(?=[^>]*data-suggestion-list)/);
    expect(outsideCards(h)).not.toMatch(/bg-card|glass|rounded-\[var\(--radius-card\)\]/);
  });
  it("nothing pending anywhere is no section", () => {
    expect(agency({ ok: true, accounts: [] })).toBe("");
  });
  it.each([["en", "Couldn't load suggestions.", "Retry"], ["es", "No se pudieron cargar las sugerencias.", "Intentar de nuevo"]] as const)(
    "%s: the read failed: the heading, the error line and Retry, no cards", (locale, words, retry) => {
      const h = agency({ ok: false }, locale);
      expect(h).toMatch(new RegExp(`<h2[^>]*>${locale === "en" ? "Suggestions" : "Sugerencias"}</h2>`));
      expect(plain(h)).toContain(words);
      expect(h).toMatch(new RegExp(`<button[^>]*>${retry}</button>`));
      expect(h).not.toMatch(/<article\b/);
    });
});
