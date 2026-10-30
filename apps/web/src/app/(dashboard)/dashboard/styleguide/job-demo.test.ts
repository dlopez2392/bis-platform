import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

// F-046 part 1 (plan Task 11, step 4): the Add job sheet (with the warnings block, and with the phone owner's
// offer) and the job drawer (a booked staff job whose confirmation is pending; a cancelled customer booking), in
// English and Spanish, from fixed specimens and INERT. The rule-8 checks count BOTH primary markers: the Button's
// `data-variant="default"` and the `btn-primary` class a Link styled with buttonVariants carries without the
// attribute.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
const { JobDemo, JOB_DEMO_SPECIMENS } = await import("./job-demo");

const html = renderToStaticMarkup(createElement(JobDemo));

/** Each specimen frame's own markup, from its opening marker to the next frame (or the end). */
function frames(attr: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(`${attr}="([^"]+)"`, "g");
  const hits = [...html.matchAll(re)];
  hits.forEach((h, i) => {
    const end = html.indexOf("data-sg-job-end", h.index!);
    out.set(h[1]!, html.slice(h.index!, end < 0 ? (hits[i + 1]?.index ?? html.length) : end));
  });
  return out;
}
/** Primaries in a slice: every <button> or <a> that carries either marker (one element counts once). */
function primaries(slice: string): string[] {
  return [...slice.matchAll(/<(button|a)\b[^>]*>/g)].map((x) => x[0]).filter((tag) => /data-variant="default"|\bbtn-primary\b/.test(tag));
}
/** The words inside a slice's one primary. */
function primaryLabel(slice: string): string {
  const tag = primaries(slice)[0]!;
  return renderedText(slice.slice(slice.indexOf(tag) + tag.length).split(/<\/(?:button|a)>/)[0]!).trim();
}
const sheets = frames("data-sg-job-sheet");
const drawers = frames("data-sg-job-drawer");

describe("styleguide: the Add job sheet and the job drawer (F-046 part 1, plan Task 11)", () => {
  it("renders two sheet specimens and two drawer specimens, each in English and Spanish (mutation: drop a locale -> FAILS)", () => {
    expect([...sheets.keys()].sort()).toEqual(["owner-en", "owner-es", "warnings-en", "warnings-es", "warnings-pseudo"]);
    expect([...drawers.keys()].sort()).toEqual(["booked-en", "booked-es", "booked-pseudo", "cancelled-en", "cancelled-es"]);
  });

  it("each sheet has exactly ONE primary, by either marker (rule 8; mutation: make Cancel default -> FAILS)", () => {
    for (const [name, slice] of sheets) expect(primaries(slice), name).toHaveLength(1);
  });

  it("the drawer has NO primary, by either marker (DESIGN.md rule 8, 2026-10-30; mutation: a variant=\"default\" Move -> FAILS)", () => {
    for (const [name, slice] of drawers) {
      expect(primaries(slice), name).toEqual([]);
      expect(slice, name).not.toContain("btn-primary");
    }
  });

  it("the warnings sheet shows the check-first block above 'Add it anyway', the primary (spec 5.4, R3)", () => {
    const en = renderedText(sheets.get("warnings-en")!);
    expect(en).toContain(m["calendar.job.checkFirst"]);
    expect(en).toContain(m["calendar.job.warn.outsideHours"]);
    expect(en).toContain(m["calendar.job.warn.overlapsOne"].replace("{time}", "6:30 PM"));
    expect(primaryLabel(sheets.get("warnings-en")!)).toBe(m["calendar.job.saveAnyway"]);
    expect(primaryLabel(sheets.get("warnings-es")!)).toBe(m["calendar.job.saveAnyway.es"]);
    expect(renderedText(sheets.get("warnings-es")!)).toContain(m["calendar.job.checkFirst.es"]);
    expect(sheets.get("warnings-en")!.indexOf("data-job-warnings")).toBeLessThan(sheets.get("warnings-en")!.indexOf(primaries(sheets.get("warnings-en")!)[0]!));
  });

  it("the phone owner's offer: 'Use Ana' is the primary, 'Add as new' is ghost (R8)", () => {
    const slice = sheets.get("owner-en")!;
    expect(primaryLabel(slice)).toBe(t(m, "calendar.job.useExisting", "en", { first: "Ana" }));
    expect(renderedText(slice)).toContain(m["calendar.job.addAsNew"]);
    expect(renderedText(slice)).toContain(t(m, "calendar.job.phoneOwner", "en", { name: "Ana García", first: "Ana" }));
    expect(primaryLabel(sheets.get("owner-es")!)).toBe(t(m, "calendar.job.useExisting", "es", { first: "Ana" }));
  });

  it("the booked staff job: Move, Cancel and Open record as ghosts, the pending email line, status as dot AND word (mutation: drop the email line -> FAILS)", () => {
    const en = drawers.get("booked-en")!;
    const text = renderedText(en);
    for (const k of ["calendar.job.titleMove", "calendar.bookings.cancel", "calendar.job.openRecord", "calendar.job.emailPending", "calendar.bookings.status.booked"] as const) {
      expect(text, k).toContain(m[k]);
    }
    expect(en).toMatch(/data-job-status="booked"[^>]*>\s*<span class="[^"]*rounded-full/);
    expect(renderedText(drawers.get("booked-es")!)).toContain(m["calendar.job.emailPending.es"]);
  });

  it("the cancelled customer booking offers no Move, no Cancel, no outcome (mutation: show Cancel on a cancelled row -> FAILS)", () => {
    const text = renderedText(drawers.get("cancelled-en")!);
    expect(text).toContain(m["calendar.bookings.status.cancelled"]);
    expect(text).toContain(m["calendar.agenda.bookedOnline"]);
    expect(text).not.toContain(m["calendar.job.titleMove"]);
    expect(drawers.get("cancelled-en")!).not.toMatch(new RegExp(`>${m["calendar.bookings.cancel"]}<`));
    expect(text).not.toContain(m["calendar.bookings.markNoShow"]);
  });

  it("every visible string is a catalogue value or a named specimen (no raw copy; mutation: a literal 'Book it now' -> FAILS)", () => {
    // A template must carry words of its own: "{date}, {count} {unit}" would otherwise accept almost any phrase.
    // Still lenient by nature ("Call {name}" accepts any phrase starting "Call "): the i18n ratchet, which counts
    // JSX literals in this new file, is the second net (src/lib/i18n/ratchet.test.ts).
    const templates = Object.values(m as Record<string, string>)
      .filter((v) => /\p{L}/u.test(v.replace(/\{[a-zA-Z]+\}/g, "")))
      .map((v) => new RegExp(`^${v.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[a-zA-Z]+\}/g, ".+?")}$`, "s"));
    const exact = new Set(Object.values(m as Record<string, string>));
    const specimens = new Set<string>(JOB_DEMO_SPECIMENS);
    // The pseudo specimens are checked on their own below: every word there is wrapped.
    const real = [...sheets, ...drawers].filter(([k]) => k.endsWith("-pseudo")).reduce((h, [, slice]) => h.replace(slice, ""), html);
    const segments = real.split(/<[^>]+>/).map((s) => renderedText(s).trim()).filter((s) => /\p{L}/u.test(s));
    const strays = segments.filter((s) => !exact.has(s) && !specimens.has(s) && !templates.some((re) => re.test(s)));
    expect(strays).toEqual([]);
  });

  it("the pseudo-locale specimens: the sheet with its warnings and the booked drawer, every word padded (design review I2; mutation: drop pseudo -> FAILS)", async () => {
    const { pseudoLocale } = await import("@/lib/i18n/pseudo-locale");
    const sheet = renderedText(sheets.get("warnings-pseudo")!);
    expect(sheet).toContain(pseudoLocale(m["calendar.job.checkFirst"]));
    expect(sheet).toContain(pseudoLocale(m["calendar.job.saveAnyway"]));
    const drawer = renderedText(drawers.get("booked-pseudo")!);
    expect(drawer).toContain(pseudoLocale(m["calendar.job.titleMove"]));
    expect(drawer).toContain(pseudoLocale(m["calendar.job.emailPending"]));
    const specimens = new Set<string>(JOB_DEMO_SPECIMENS);
    for (const slice of [sheets.get("warnings-pseudo")!, drawers.get("booked-pseudo")!]) {
      // The frame's slice opens inside its own tag and closes inside the end marker's: only what lies between.
      const bare = slice.slice(slice.indexOf(">") + 1, slice.lastIndexOf("<")).split(/<[^>]+>/).map((x) => renderedText(x).trim()).filter((x) => /\p{L}/u.test(x))
        .filter((x) => !/^\[[\s\S]*\]$/.test(x) && !specimens.has(x));
      expect(bare).toEqual([]);
    }
  });

  it("nothing is fixed-width, so /styleguide never scrolls sideways at 375px (e2e/phone-width.spec.ts)", () => {
    expect(html).toMatch(/^<div class="[^"]*\bmin-w-0\b/);
    expect(html).not.toMatch(/(?<!max-)\bw-\[\d+px\]/);
    expect(html).not.toMatch(/\bmin-w-\[\d+px\]/);
  });

  // CI phone-width.spec.ts (feat/calendar-agenda, 5d9933c4): the customer-search trigger ("Search by name or
  // phone") is a Button, which is `inline-flex` + `shrink-0` + `whitespace-nowrap` (buttonVariants) — its
  // pseudo-locale label (289px) pushed /styleguide to 419px at a 375px viewport. It must opt OUT of all three
  // itself: full width, able to shrink below its content, and its label in its own min-w-0 truncate span.
  it("375 px: the customer-search trigger fits its container in every language (mutation: drop its shrink class -> FAILS)", () => {
    const triggers = [...html.matchAll(/<button[^>]*\bdata-job-change-customer\b[^>]*>[\s\S]*?<\/button>/g)].map((x) => x[0]);
    expect(triggers.length).toBeGreaterThan(0);
    for (const btn of triggers) {
      expect(btn).toMatch(/class="(?=[^"]*\bw-full\b)(?=[^"]*\bmin-w-0\b)[^"]*"/);
      expect(btn).toMatch(/<span class="(?=[^"]*\bmin-w-0\b)(?=[^"]*\btruncate\b)[^"]*">/);
    }
  });

  it("is INERT: no specimen reaches a server action (mutation: wire addJobAction into the demo -> FAILS)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("./job-demo.tsx", import.meta.url)), "utf8");
    expect(src).not.toMatch(/Action\b|agenda-actions|calendar\/actions/);
  });
});
