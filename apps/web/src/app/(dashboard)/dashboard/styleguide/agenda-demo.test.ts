import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The Day rows push a URL and the Add job sheet is T11's client component: neither runs here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../accounts/[accountId]/calendar/job-sheet", () => ({ JobSheet: () => null }));

const { AgendaDemo } = await import("./agenda-demo");
const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");

/** F-046 part 1 (plan Task 12, DoD): /styleguide shows the Agenda card in every state it has. */
describe("styleguide: the Agenda card", () => {
  const html = renderToStaticMarkup(createElement(AgendaDemo));
  const text = renderedText(html);
  const cards = html.split(/(?=<section aria-labelledby="[^"]*" data-agenda-card=)/).slice(1);
  const primaries = (s: string) => s.match(/data-variant="default"/g)?.length ?? 0;

  it("each card's header carries exactly ONE primary, Add job; the Technician's and the error card none (rule 8; mutation: a second primary -> FAILS)", () => {
    const ready = cards.filter((c) => c.includes('data-agenda-card="ready"'));
    expect(ready.length).toBeGreaterThanOrEqual(4);
    for (const c of ready) expect(primaries(c), c.slice(0, 120)).toBe(c.includes('aria-labelledby="sg-agenda-technician"') ? 0 : 1);
    const error = cards.filter((c) => c.includes('data-agenda-card="error"'));
    expect(error).toHaveLength(1);
    expect(primaries(error[0]!)).toBe(0);
  });

  it("the Day shows an overlap side by side, an outside-hours row, a cancelled row and exactly two free rows", () => {
    const day = cards.find((c) => c.includes('aria-labelledby="sg-agenda-day"'))!;
    expect(day).toContain("data-agenda-side");
    expect(day).toContain("data-agenda-outside");
    expect(day).toContain('data-agenda-row="cancelled"');
    expect(day.match(/data-agenda-free/g)).toHaveLength(2);
  });

  it("a closed head (in Spanish), a Week, a Technician's empty day, the error and the skeleton", () => {
    expect(html).toContain("data-agenda-closed");
    expect(text).toContain(m["calendar.agenda.closed.es"].replace("{reason}", m["business.reason.holiday.es"]));
    expect(html).toContain("data-agenda-week");
    expect(text).toContain(m["calendar.agenda.emptyTechnician"].replace("{day}", "Friday, November 6"));
    expect(text).toContain(m["calendar.agenda.error"]);
    expect(html).toContain("data-agenda-skeleton");
  });

  it("a pseudo-locale specimen: the Day card with every word padded (design review I2; mutation: drop it -> FAILS)", async () => {
    const { pseudoLocale } = await import("@/lib/i18n/pseudo-locale");
    const pseudo = cards.find((c) => c.includes('aria-labelledby="sg-agenda-pseudo"'));
    expect(pseudo).toBeDefined();
    const words = renderedText(pseudo!);
    expect(words).toContain(pseudoLocale(m["calendar.agenda.title"]));
    expect(words).toContain(pseudoLocale(m["calendar.agenda.addJob"]));
    expect(words).toContain(pseudoLocale(m["calendar.bookings.status.booked"]));
  });

  // Spec §5.3 / CI phone-width.spec at 375 px: the Back · Today · Next row was a non-wrapping `flex` of
  // nowrap buttons (342 px under the pseudo-locale) and pushed the page to 472 px. A flex ROW either wraps
  // or has a child that may shrink below its content (`min-w-0`); a `flex-col` stacks and cannot widen.
  it("375 px: every flex row in every card state wraps or has a child that may shrink (mutation: drop flex-wrap from Back · Today · Next -> FAILS)", () => {
    const rows = [...html.matchAll(/<(\w+)\b[^>]*\bclass="([^"]*)"[^>]*>/g)].filter((x) => {
      const cls = x[2]!.split(/\s+/);
      return cls.includes("flex") && !cls.includes("flex-col");
    });
    expect(rows.length).toBeGreaterThan(3);
    const stuck = rows.filter((x) => {
      if (x[2]!.split(/\s+/).includes("flex-wrap")) return false;
      const from = x.index! + x[0].length;
      const inner = html.slice(from, html.indexOf(`</${x[1]}>`, from));
      return !/class="[^"]*\bmin-w-0\b/.test(inner);
    }).map((x) => x[0]);
    expect(stuck).toEqual([]);
  });
  it("375 px: the Week's 7-day strip keeps each day inside its seventh (min-w-0 + break-words on every day link)", () => {
    const strips = [...html.matchAll(/<nav [^>]*class="grid grid-cols-7[^"]*"[^>]*>([\s\S]*?)<\/nav>/g)];
    expect(strips.length).toBeGreaterThan(0);
    for (const s of strips) {
      const links = s[1]!.match(/<a [^>]*>/g) ?? [];
      expect(links).toHaveLength(7);
      for (const a of links) expect(a).toMatch(/class="(?=[^"]*\bmin-w-0\b)(?=[^"]*\bbreak-words\b)[^"]*"/);
    }
  });

  it("no two rows share an anchor id across the demo's cards", () => {
    const ids = [...html.matchAll(/id="(booking-[^"]+)"/g)].map((x) => x[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
