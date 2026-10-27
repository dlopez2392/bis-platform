import { describe, it, expect, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeTr } from "@/lib/record/copy";
import type { WorkRow } from "@bis/db";
import { m } from "@/lib/messages";
import { LocaleProvider } from "@/components/locale-provider";

vi.mock("./actions", () => ({
  completeWorkTask: vi.fn(), reopenWorkTask: vi.fn(), dismissToTask: vi.fn(), closeOutBooking: vi.fn(),
  confirmStopFromTask: vi.fn(), notAStopFromTask: vi.fn(), undoHoldDecisionFromTask: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { WorkList } = await import("./work-list");

const task = (id: string, title: string, callId: string | null): WorkRow => ({
  id: `task:${id}`, source: "task", accountId: "a1", contactId: "c1", title,
  dueAt: "2026-10-09T17:00:00Z", occurredAt: "2026-10-09T17:00:00Z", consent: null, callId,
});

describe("the callback To do on today's queue (F-033; DESIGN.md provenance)", () => {
  it("a To do a call left carries the receptionist's author mark; one a person typed does not (mutation: mark every task → FAILS; mark none → FAILS)", () => {
    const out = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [task("t1", "Call back at 9565061545: Roof leak", "call1"), task("t2", "Order shingles", null)], waiting: [] },
      accountId: "a1", contactNames: { c1: "Ana Reyes" }, timezone: "America/Chicago", tr: makeTr("en"),
    }));
    const rows = out.split("<li").slice(1);
    const callback = rows.find((r) => r.includes("Roof leak"))!;
    const typed = rows.find((r) => r.includes("Order shingles"))!;
    expect(callback).toContain("Sofía · AI");
    expect(typed).not.toContain("· AI");
    // Still the person's row: the contact name stays beside the mark —
    // as its own element, never fused into "Ana Reyes · Sofía · AI", which
    // reads as three dot-parts (M9; mutation: join them in one string → FAILS).
    expect(callback).toContain("Ana Reyes");
    expect(callback).toMatch(/<span[^>]*data-ai-mark[^>]*>Sofía · AI<\/span>/);
    expect(callback).not.toContain("Ana Reyes · Sofía");
  });
});

// F-085 follow-up (Task B): WorkRowActions reads the To do page's
// LocaleProvider (requestLocale) through context for its Done/Not now
// buttons, the same way AssigneeField and BulkActionBar already do.
describe("WorkRowActions reads the LocaleProvider's locale (F-085 follow-up, Task B)", () => {
  it("Done and Not now read Spanish when the page's locale is es (mutation: hard-code useLocale()'s default -> FAILS)", () => {
    const out = renderToStaticMarkup(
      createElement(LocaleProvider, { locale: "es" } as ComponentProps<typeof LocaleProvider>, createElement(WorkList, {
        buckets: {
          overdue: [],
          today: [task("t1", "Order shingles", null), task("t2", "Reply to Ana", "call1")],
          waiting: [],
        },
        accountId: "a1", contactNames: { c1: "Ana Reyes" }, timezone: "America/Chicago", tr: makeTr("es"),
      })),
    );
    expect(out).toContain(`>${m["work.done.es"]}<`);
  });
});

// F-085 follow-ups (design I2 / final I1): the row's own date and the
// receptionist's mark read the page's language too, not only its sentences.
describe("a Spanish To do row's date and AI mark (F-085 follow-ups)", () => {
  const render = (locale: "en" | "es") => renderToStaticMarkup(createElement(WorkList, {
    buckets: { overdue: [], today: [task("t1", "Call back at 9565061545: Roof leak", "call1")], waiting: [] },
    accountId: "a1", contactNames: { c1: "Ana Reyes" }, timezone: "America/Chicago", tr: makeTr(locale),
  }));

  it("the date is formatted in Spanish (mutation: drop tr.locale from rowDateText's formatDateInZone -> FAILS)", () => {
    const es = render("es");
    expect(es).toMatch(/<span[^>]*data-work-row-date[^>]*>9 oct 2026<\/span>/);
    expect(render("en")).toMatch(/<span[^>]*data-work-row-date[^>]*>Oct 9, 2026<\/span>/);
  });

  it("the callback's author mark reads \"Sofía · IA\" in Spanish, \"Sofía · AI\" in English (mutation: render <AiAuthorMark /> with no locale -> FAILS)", () => {
    expect(render("es")).toMatch(/<span[^>]*data-ai-mark[^>]*>Sofía · IA<\/span>/);
    expect(render("en")).toMatch(/<span[^>]*data-ai-mark[^>]*>Sofía · AI<\/span>/);
  });
});
