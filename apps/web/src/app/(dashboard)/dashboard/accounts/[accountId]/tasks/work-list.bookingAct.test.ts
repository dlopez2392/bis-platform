import { describe, it, expect, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeTr } from "@/lib/record/copy";
import type { WorkRow } from "@bis/db";
import type { AiAct } from "@bis/db/ai-act-rules";
import { m } from "@/lib/messages";
import { LocaleProvider } from "@/components/locale-provider";

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
});
