import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { formatRelativeTime } from "@/lib/format";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import type { FeedCardView } from "./feed-card-data";

/**
 * F-048 part 2: the "Bookings on your phone" card, every state, in English and Spanish. Rendered with
 * `renderToStaticMarkup` + `createElement` (closed-days-card.test.ts's form); what the buttons DO is in
 * feed-card-handlers.test.ts.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { FeedCard } = await import("./feed-card");

const URL_ = "https://app.bis-rgv.com/cal/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd.ics";
const WEBCAL = "webcal://app.bis-rgv.com/cal/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd.ics";
const live = (over: Partial<Extract<FeedCardView, { kind: "live" }>> = {}): FeedCardView =>
  ({ kind: "live", url: URL_, webcal: WEBCAL, lastFetchedAt: null, technician: false, ...over });
const ALL: FeedCardView[] = [
  { kind: "agency" }, { kind: "unavailable" }, { kind: "none" }, { kind: "stale" }, { kind: "error" }, live(),
];
const action = async () => ({ ok: true as const, undo: null });

function render(view: FeedCardView, locale: Locale = "en", pseudo = false): string {
  return renderToStaticMarkup(createElement(FeedCard, {
    view, locale, pseudo, make: action, replace: action, turnOff: action, undo: action,
  }));
}
const primaries = (html: string) => (html.match(/data-variant="default"/g) ?? []).length;
const text = (key: string, locale: Locale) => makeTr(locale).text(key as Parameters<ReturnType<typeof makeTr>["text"]>[0]);

describe("FeedCard — the sentence each state says, in both languages", () => {
  const SENTENCE: Record<FeedCardView["kind"], string> = {
    agency: "calendar.feed.agency", unavailable: "calendar.feed.unavailable", none: "calendar.feed.empty",
    stale: "calendar.feed.stale", error: "calendar.feed.loadError", live: "calendar.feed.private",
  };
  for (const locale of ["en", "es"] as const) {
    it.each(ALL.map((v) => [v.kind, v] as const))(`${locale}: %s`, (kind, view) => {
      const t = renderedText(render(view, locale));
      expect(t).toContain(text("calendar.feed.title", locale));
      expect(t).toContain(text(SENTENCE[kind], locale));
    });
  }

  it("the root is the palette's anchor, #phone-calendar, marked data-feed-card", () => {
    for (const v of ALL) expect(render(v), v.kind).toMatch(/^<div(?=[^>]*\bid="phone-calendar")(?=[^>]*\bdata-feed-card)[^>]*>/);
  });
});

describe("FeedCard — one primary per state (DESIGN.md rule 8)", () => {
  it.each([["none", 1], ["stale", 1], ["live", 1], ["agency", 0], ["unavailable", 0], ["error", 0]] as const)(
    "%s carries exactly %i primary button (mutation: give Make a new link variant=default → the live case FAILS)",
    (kind, n) => {
      const view = ALL.find((v) => v.kind === kind)!;
      expect(primaries(render(view))).toBe(n);
    },
  );

  it("the primary is Make my link when there is none, Make a new link when stale, Copy link when live", () => {
    const primaryText = (html: string) => renderedText(/<button[^>]*data-variant="default"[^>]*>([\s\S]*?)<\/button>/.exec(html)![1]!);
    expect(primaryText(render({ kind: "none" }))).toBe(m["calendar.feed.make"]);
    expect(primaryText(render({ kind: "stale" }))).toBe(m["calendar.feed.replace"]);
    expect(primaryText(render(live()))).toBe(m["calendar.feed.copy"]);
  });
});

describe("FeedCard — the live link", () => {
  it("the read-only field holds the https link, and Add to iPhone is the webcal link", () => {
    const html = render(live());
    const input = /<input[^>]*>/.exec(html)![0];
    expect(input).toContain(`value="${URL_}"`);
    expect(input).toMatch(/\breadonly=""/i); // React 19's static markup writes it readOnly=""
    expect(input).toContain(`aria-label="${m["calendar.feed.linkLabel"]}"`);
    expect(html).toContain(`href="${WEBCAL}"`);
    const t = renderedText(html);
    for (const k of ["calendar.feed.addIphone", "calendar.feed.replace", "calendar.feed.turnOff", "calendar.feed.window", "calendar.feed.howTo", "calendar.feed.slow"] as const) {
      expect(t, k).toContain(m[k]);
    }
  });

  it("the instructions are in a <details>, closed until tapped, with all three apps", () => {
    const html = render(live());
    expect(html).toMatch(/<details(?![^>]*\bopen\b)[^>]*>\s*<summary[^>]*>[^<]*How to add it/);
    const t = renderedText(html);
    for (const k of ["iphone", "google", "outlook"] as const) {
      expect(t).toContain(m[`calendar.feed.${k}.title`]);
      // Each numbered step of the catalogue's sentence appears (the card lists them one per line).
      for (const step of m[`calendar.feed.${k}.steps`].split(/\s(?=\d\.\s)/)) expect(t).toContain(step.replace(/^\d\.\s/, ""));
    }
  });

  it("the Technician line appears only for a Technician's link", () => {
    expect(renderedText(render(live({ technician: true })))).toContain(m["calendar.feed.technician"]);
    expect(renderedText(render(live({ technician: false })))).not.toContain(m["calendar.feed.technician"]);
    expect(renderedText(render({ kind: "none" }))).not.toContain(m["calendar.feed.technician"]);
  });

  it("says when the calendar last asked, or that none has yet", () => {
    const at = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(renderedText(render(live({ lastFetchedAt: at }))))
      .toContain(makeTr("en").text("calendar.feed.lastChecked", { when: formatRelativeTime(at, "en") }));
    expect(renderedText(render(live({ lastFetchedAt: at }), "es")))
      .toContain(makeTr("es").text("calendar.feed.lastChecked", { when: formatRelativeTime(at, "es") }));
    expect(renderedText(render(live()))).toContain(m["calendar.feed.neverChecked"]);
  });
});

describe("FeedCard — Spanish", () => {
  it("no English sentence of the card appears under es, in any state (mutation: delete calendar.feed.copy.es → FAILS)", () => {
    const en = Object.entries(m).filter(([k]) => k.startsWith("calendar.feed.") && !k.endsWith(".es"))
      .filter(([k, v]) => (m as Record<string, string>)[`${k}.es`] !== v);
    for (const v of [...ALL, live({ technician: true, lastFetchedAt: "2026-10-28T10:00:00.000Z" })]) {
      const t = renderedText(render(v, "es"));
      for (const [k, s] of en) expect(t, `${v.kind}: ${k}`).not.toContain(s);
    }
    expect(renderedText(render({ kind: "none" }, "es"))).not.toContain("Make my link");
  });

  it("the pseudo-locale wraps the card's words", () => {
    expect(renderedText(render({ kind: "none" }, "en", true))).not.toContain(m["calendar.feed.make"]);
  });
});

describe("FeedCard — the client bundle (review M9)", () => {
  const dir = join(__dirname);
  const card = readFileSync(join(dir, "feed-card.tsx"), "utf8");
  const handlers = readFileSync(join(dir, "feed-card-handlers.ts"), "utf8");

  it("feed-card.tsx imports FeedCardView type-only (mutation: `import type` → `import` → FAILS)", () => {
    expect(card).toMatch(/import type \{[^}]*FeedCardView[^}]*\} from "\.\/feed-card-data"/);
    expect(card).not.toMatch(/^import (?!type)[^;]*from "\.\/feed-card-data"/m);
  });

  it("neither client file imports a value from feed-card-data, nor names the token module or node:crypto", () => {
    for (const [name, src] of [["feed-card.tsx", card], ["feed-card-handlers.ts", handlers]] as const) {
      expect(src, name).not.toMatch(/^import (?!type)[^;]*from "\.\/feed-card-data"/m);
      expect(src, name).not.toMatch(/feed-token|node:crypto/);
    }
  });
});
