import { describe, it, expect, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeTr } from "@/lib/record/copy";
import type { WorkRow } from "@bis/db";
import type { AiAct } from "@bis/db/ai-act-rules";
import { m } from "@/lib/messages";
import { LocaleProvider } from "@/components/locale-provider";
import { describeAct } from "@/lib/ai-acts/kinds";

vi.mock("./actions", () => ({
  completeWorkTask: vi.fn(), reopenWorkTask: vi.fn(), dismissToTask: vi.fn(), closeOutBooking: vi.fn(),
  confirmStopFromTask: vi.fn(), notAStopFromTask: vi.fn(), undoHoldDecisionFromTask: vi.fn(),
  completeFailedTransfer: vi.fn(), reopenFailedTransfer: vi.fn(), acceptBookingAct: vi.fn(), unacceptBookingAct: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { WorkList } = await import("./work-list");

const ACT: AiAct = {
  id: "act1", accountId: "a1", actor: "voice", callId: "call1", chatId: null, contactId: "ct1",
  kind: "booking_cancelled", target: { bookingId: "bk1" },
  before: { startsAt: "2026-11-10T16:00:00Z", endsAt: "2026-11-10T17:00:00Z" }, after: { version: "2026-11-10T15:00:00Z" },
  createdAt: "2026-11-06T15:00:00Z", undoneAt: null, undoneBy: null, undoNotified: false,
};
const bookingActRow = (): WorkRow => ({
  id: "booking_act:act1", source: "booking_act", accountId: "a1", contactId: "ct1", title: "",
  dueAt: null, occurredAt: "2026-11-06T15:00:00Z", bookingAct: ACT,
});

describe("a booking-act row (F-077 part 1)", () => {
  it("renders describeAct's own verb verbatim and offers exactly one button, Accept/Aceptar (mutation: render a second button -> the exactly-one-child-button assertion FAILS)", () => {
    const en = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [], waiting: [bookingActRow()] },
      accountId: "a1", contactNames: { ct1: "Pat Nunez" }, timezone: "America/Chicago", tr: makeTr("en"),
    }));
    const row = en.split("<li").slice(1).find((r) => r.includes("Pat Nunez"))!;
    expect(row).toContain(">" + m["work.act.accept"] + "<");
    const buttons = row.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBe(1);

    // WorkRowActions' own button label reads useLocale() (React context), decoupled from the `tr`
    // prop that drives describeAct's own sentence (work-list.callback.test.ts's own "WorkRowActions
    // reads the LocaleProvider's locale" precedent) -- so the Spanish button needs the provider too.
    const es = renderToStaticMarkup(
      createElement(LocaleProvider, { locale: "es" } as ComponentProps<typeof LocaleProvider>, createElement(WorkList, {
        buckets: { overdue: [], today: [], waiting: [bookingActRow()] },
        accountId: "a1", contactNames: { ct1: "Pat Nunez" }, timezone: "America/Chicago", tr: makeTr("es"),
      })),
    );
    expect(es).toContain(">" + m["work.act.accept.es"] + "<");
  });

  // R1 (fix round): pins the per-account screen's primary sentence to describeAct's OWN verb, in each
  // locale's own tr -- not merely "some text appears" (mutation: primaryLabel's booking_act branch ->
  // return "MUTANT" -> FAILS, since neither row would contain its real verb any more).
  it("the row's own sentence IS describeAct's verb for this tr/zone, in English and in Spanish (mutation: primaryLabel's booking_act branch returns \"MUTANT\" -> FAILS)", () => {
    const en = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [], waiting: [bookingActRow()] },
      accountId: "a1", contactNames: { ct1: "Pat Nunez" }, timezone: "America/Chicago", tr: makeTr("en"),
    }));
    const enVerb = describeAct(ACT, { tr: makeTr("en"), zone: "America/Chicago" }).verb;
    expect(en).toContain(`>${enVerb}<`);

    const es = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [], waiting: [bookingActRow()] },
      accountId: "a1", contactNames: { ct1: "Pat Nunez" }, timezone: "America/Chicago", tr: makeTr("es"),
    }));
    const esVerb = describeAct(ACT, { tr: makeTr("es"), zone: "America/Chicago" }).verb;
    expect(es).toContain(`>${esVerb}<`);
  });

  // D1 (design CRITICAL, DESIGN.md Provenance): a live act is always Sofía's
  // (author-mark.ts:78's own "aiAct" case) -- the booking-change row must carry the same AI mark the
  // callback task rows already carry, not only the bare verb (mutation: drop the mark -> FAILS).
  it("carries the AI author mark, the same element the callback rows already carry (mutation: drop it -> FAILS)", () => {
    const en = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [], waiting: [bookingActRow()] },
      accountId: "a1", contactNames: { ct1: "Pat Nunez" }, timezone: "America/Chicago", tr: makeTr("en"),
    }));
    const row = en.split("<li").slice(1).find((r) => r.includes("Pat Nunez"))!;
    expect(row).toMatch(/<span[^>]*data-ai-mark[^>]*>Sofía · AI<\/span>/);
  });
});

// R7 (fix round): a rescheduled booking act carries describeAct's own "From {when}" DETAIL too, not
// only its verb -- the row's secondary line, when the act has one (booking_rescheduled is the only
// kind with a non-null detail today; booking_created/booking_cancelled's detail is null).
describe("a rescheduled booking-act row shows its own detail line (F-077 part 1, R7)", () => {
  const RESCHEDULED: AiAct = {
    id: "act2", accountId: "a1", actor: "voice", callId: "call1", chatId: null, contactId: "ct1",
    kind: "booking_rescheduled",
    target: { bookingId: "bk2", fromBookingId: "bk1" },
    before: { startsAt: "2026-11-09T16:00:00Z", endsAt: "2026-11-09T17:00:00Z", version: "2026-11-05T15:00:00Z" },
    after: { startsAt: "2026-11-11T16:00:00Z", endsAt: "2026-11-11T17:00:00Z" },
    createdAt: "2026-11-06T15:00:00Z", undoneAt: null, undoneBy: null, undoNotified: false,
  };
  const rescheduledRow = (): WorkRow => ({
    id: "booking_act:act2", source: "booking_act", accountId: "a1", contactId: "ct1", title: "",
    dueAt: null, occurredAt: "2026-11-06T15:00:00Z", bookingAct: RESCHEDULED,
  });

  it("the detail (\"From {when}\") renders verbatim, in English and Spanish (mutation: drop the detail from the row -> FAILS)", () => {
    const en = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [], waiting: [rescheduledRow()] },
      accountId: "a1", contactNames: { ct1: "Pat Nunez" }, timezone: "America/Chicago", tr: makeTr("en"),
    }));
    const { verb, detail } = describeAct(RESCHEDULED, { tr: makeTr("en"), zone: "America/Chicago" });
    expect(detail).not.toBeNull();
    expect(en).toContain(`>${verb}<`);
    const row = en.split("<li").slice(1).find((r) => r.includes(verb))!;
    expect(row).toContain(`>${detail}<`);

    const es = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [], waiting: [rescheduledRow()] },
      accountId: "a1", contactNames: { ct1: "Pat Nunez" }, timezone: "America/Chicago", tr: makeTr("es"),
    }));
    const esParts = describeAct(RESCHEDULED, { tr: makeTr("es"), zone: "America/Chicago" });
    const esRow = es.split("<li").slice(1).find((r) => r.includes(esParts.verb))!;
    expect(esRow).toContain(`>${esParts.detail}<`);
  });

  it("a kind with no detail (booking_cancelled) still falls back to the contact's own name on the secondary line (regression: the fallback must survive the new branch)", () => {
    const en = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [], waiting: [bookingActRow()] },
      accountId: "a1", contactNames: { ct1: "Pat Nunez" }, timezone: "America/Chicago", tr: makeTr("en"),
    }));
    const row = en.split("<li").slice(1).find((r) => r.includes("Pat Nunez"))!;
    expect(row).toContain("Pat Nunez");
  });
});
