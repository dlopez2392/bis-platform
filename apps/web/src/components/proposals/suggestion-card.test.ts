import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Proposal } from "@bis/db/proposal-rules";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { renderedText } from "@/lib/rendered-text";
import { buildSuggestionView } from "@/lib/proposals/view";
import { SuggestionCard } from "./suggestion-card";
import { AI_MARK_CLASS } from "@/app/(dashboard)/dashboard/accounts/[accountId]/calls/ai-author-mark";
import { CALL_AT, FIVE, NAMES, NOW, PIPELINE_STAGES, STAGES, TITLE, ZONE, rows } from "./suggestion-specimens";

/** Views built by the real builder from typed-out rows; markup by renderToStaticMarkup (no DOM). */
const ok = async () => ({ ok: true as const, status: "accepted" as const, toast: "Done" });
const actions = { accept: ok, editAccept: ok, discard: ok, undo: async () => ({ ok: true as const, message: "Undone." }) };
function card(row: Proposal, locale: Locale = "en", opts: { pseudo?: boolean; persona?: string } = {}) {
  const view = buildSuggestionView(row, {
    tr: makeTr(locale, opts.pseudo ?? false), zone: ZONE, now: NOW, stages: STAGES, pipelineStages: PIPELINE_STAGES,
    callerName: "Ana Lopez", callStartedAt: CALL_AT, personaName: opts.persona ?? "Sofia", names: NAMES, viewerId: null,
  });
  return renderToStaticMarkup(createElement(SuggestionCard, { view, ...actions }));
}
const plain = (s: string) => renderedText(s).replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
/** The status block: the dot element, then its word. */
const statusOf = (h: string) => {
  const m = /<span[^>]*data-status-dot[^>]*><\/span>\s*(?:<!-- -->)?\s*<span[^>]*data-status-word[^>]*>([^<]*)<\/span>/.exec(h);
  return m?.[1] ?? null;
};
const buttonCount = (h: string) => (h.match(/<button\b/g) ?? []).length;

describe("SuggestionCard: the five states in English (rule 3: dot and word)", () => {
  it.each([
    ["pending", "Suggested", null],
    ["accepted", "Accepted", "Accepted by Ana Lopez · 9:42 AM"],
    ["edited", "Edited", "Edited by Ana Lopez · 9:42 AM"],
    ["dismissed", "Discarded", "Discarded by Ana Lopez · 9:42 AM"],
    ["expired", "Out of date", "Marked out of date · 9:42 AM"],
  ] as const)("%s reads %s, with its decided line", (state, word, decided) => {
    const h = card(rows[state]);
    expect(statusOf(h)).toBe(word);
    if (decided) expect(plain(h)).toContain(decided);
    else expect(plain(h)).not.toMatch(/ by /);
    expect(buttonCount(h)).toBe(state === "pending" ? 3 : 0);
  });
  it("out of date carries its reason line and no buttons", () => {
    const h = card(rows.expired);
    expect(plain(h)).toContain("This deal has moved since.");
    expect(buttonCount(h)).toBe(0);
  });
  it("a pending row past expiresAt renders Out of date, More than 30 days old, and no buttons (effectiveStatus)", () => {
    const h = card(rows.aged);
    expect([statusOf(h), plain(h).includes("More than 30 days old."), buttonCount(h)]).toEqual(["Out of date", true, 0]);
    expect(h).toMatch(/<article[^>]*data-status="expired"/);
  });
});

describe("SuggestionCard: the same five in Spanish", () => {
  it("each status word is the Spanish one, and the decided line is Spanish", () => {
    expect(FIVE.map((s) => statusOf(card(rows[s], "es")))).toEqual(["Pendiente", "Aceptada", "Editada", "Descartada", "Vencida"]);
    expect(plain(card(rows.accepted, "es"))).toContain("Aceptada por Ana Lopez · 9:42 a.m.");
    expect(plain(card(rows.pending, "es"))).toContain("Porque quien llamó dijo");
  });
});

describe("SuggestionCard: lang", () => {
  it("the article carries the reader's language, the model's title lang=en, the evidence its own language", () => {
    const es = card(rows.pending, "es");
    expect(es).toMatch(/^<article[^>]*lang="es"/);
    expect(es).toContain(`<span lang="en">${TITLE}</span>`);
    const en = card(rows.spanishEvidence, "en");
    expect(en).toMatch(/^<article[^>]*lang="en"/);
    expect(en).toMatch(/<q[^>]*lang="es"[^>]*>¿Me puede llamar el jueves\?<\/q>/);
  });
});

describe("SuggestionCard: the persona mark", () => {
  it("names the account's persona, never a hard-coded Sofía, in both languages", () => {
    expect(card(rows.pending, "en", { persona: "Ana" })).toMatch(/data-ai-mark[^>]*>Ana · AI</);
    expect(card(rows.pending, "es", { persona: "Ana" })).toMatch(/data-ai-mark[^>]*>Ana · IA</);
    expect(card(rows.pending)).toContain(`class="${AI_MARK_CLASS}">Sofia · AI</span>`);
  });
});

describe("SuggestionCard: the evidence is never clamped", () => {
  it("no line-clamp anywhere in the card", () => {
    for (const s of FIVE) expect(card(rows[s])).not.toMatch(/line-clamp|truncate/);
  });
});

describe("SuggestionCard: the pseudo-locale", () => {
  it("every visible string but the model's title and the caller's words is pseudo-localised", () => {
    for (const s of [...FIVE, "aged"] as const) {
      const h = card(rows[s], "en", { pseudo: true });
      const nodes = h.split(/<[^>]*>/).map((x) => x.trim()).filter(Boolean);
      const own = nodes.filter((x) => x !== TITLE && x !== rows[s].evidence);
      expect(own.length).toBeGreaterThan(3);
      // The module's own marker (its [ ] wrapper or a pad word), never a bare accent: an accented specimen
      // name would pass raw (Task 7 review I1), so the specimens are accent-free.
      expect(own.filter((x) => !/[[\]]|Ẋẋ|Ṿṿ/.test(x))).toEqual([]);
    }
  });
});

describe("SuggestionCard: tokens only", () => {
  it("no hex colour, and no radius but the card's, the control's and the pill's", () => {
    for (const s of FIVE) {
      const h = card(rows[s]);
      expect(h).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      const radii = new Set(h.match(/rounded-[^\s"]+/g) ?? []);
      expect([...radii].filter((r) => !["rounded-[var(--radius-card)]", "rounded-[var(--radius-ctl)]", "rounded-full"].includes(r))).toEqual([]);
    }
  });
});

describe("SuggestionCard: the e2e's scope", () => {
  it("the root carries data-suggestion and data-status", () => {
    expect(card(rows.accepted)).toMatch(/^<article[^>]*data-suggestion="sg_accepted"[^>]*data-status="accepted"/);
  });
});
