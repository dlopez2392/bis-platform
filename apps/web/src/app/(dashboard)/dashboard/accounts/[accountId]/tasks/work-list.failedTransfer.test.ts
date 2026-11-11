import { describe, it, expect, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeTr } from "@/lib/record/copy";
import type { WorkRow } from "@bis/db";
import { m } from "@/lib/messages";
import { LocaleProvider } from "@/components/locale-provider";
import { renderedText } from "@/lib/rendered-text";

vi.mock("./actions", () => ({
  completeWorkTask: vi.fn(), reopenWorkTask: vi.fn(), dismissToTask: vi.fn(), closeOutBooking: vi.fn(),
  confirmStopFromTask: vi.fn(), notAStopFromTask: vi.fn(), undoHoldDecisionFromTask: vi.fn(),
  completeFailedTransfer: vi.fn(), reopenFailedTransfer: vi.fn(), acceptBookingAct: vi.fn(), unacceptBookingAct: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { WorkList } = await import("./work-list");

const transfer = (id: string, contactId: string | null, callbackNumber: string | null): WorkRow => ({
  id: `failed_transfer:${id}`, source: "failed_transfer", accountId: "a1", contactId, title: "",
  dueAt: null, occurredAt: "2026-11-06T15:00:00Z", callbackNumber,
});

describe("a failed-transfer row (F-077 part 1)", () => {
  it("renders the numbered sentence and the \"Called back\" button, in English and Spanish", () => {
    const en = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [], waiting: [transfer("c1", "ct1", "9565551212")] },
      accountId: "a1", contactNames: { ct1: "Rio Flores" }, timezone: "America/Chicago", tr: makeTr("en"),
    }));
    expect(en).toContain(m["work.failedTransfer"].replace("{number}", "9565551212"));
    expect(en).toContain(`>${m["work.failedTransfer.done"]}<`);

    // WorkRowActions' own button label reads useLocale() (React context), decoupled from the `tr`
    // prop that drives the row's sentence/date (work-list.callback.test.ts's own "WorkRowActions
    // reads the LocaleProvider's locale" precedent) -- so the Spanish button needs the provider too.
    const es = renderToStaticMarkup(
      createElement(LocaleProvider, { locale: "es" } as ComponentProps<typeof LocaleProvider>, createElement(WorkList, {
        buckets: { overdue: [], today: [], waiting: [transfer("c1", "ct1", "9565551212")] },
        accountId: "a1", contactNames: { ct1: "Rio Flores" }, timezone: "America/Chicago", tr: makeTr("es"),
      })),
    );
    expect(es).toContain(m["work.failedTransfer.es"].replace("{number}", "9565551212"));
    expect(es).toContain(`>${m["work.failedTransfer.done.es"]}<`);
  });

  // m3 (fix round): "Called back" gets its own selector, distinct from the task's generic Done, so a
  // test (or a future caller) can address the two buttons without reading their label text.
  it("\"Called back\" carries its own selector, data-work-row-callback-done, not the task's data-work-row-done (mutation: revert to data-work-row-done -> FAILS)", () => {
    const en = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [], waiting: [transfer("c1", "ct1", "9565551212")] },
      accountId: "a1", contactNames: { ct1: "Rio Flores" }, timezone: "America/Chicago", tr: makeTr("en"),
    }));
    expect(en).toMatch(/<button[^>]*data-work-row-callback-done[^>]*>/);
    expect(en).not.toMatch(/<button[^>]*data-work-row-done[^>]*>/);
  });

  it("falls back to the bare sentence with no number (mutation: swap the .bare branch's condition -> a numbered row renders bare or vice versa -> FAILS)", () => {
    const out = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [], waiting: [transfer("c1", null, null)] },
      accountId: "a1", contactNames: {}, timezone: "America/Chicago", tr: makeTr("en"),
    }));
    // renderedText (rendered-text.ts): React escapes the apostrophe in "couldn't" to `&#x27;` in
    // static markup, so a raw `.toContain` against `m[...]`'s own straight quote matches nothing
    // however correctly the component renders -- the exact trap that file's own doc comment names.
    const text = renderedText(out);
    expect(text).toContain(m["work.failedTransfer.bare"]);
    expect(text).not.toContain(m["work.failedTransfer"].split(" {number}")[0]);
  });

  it("a contact-less row renders as the non-link <div> branch, not a <Link href=\"#\"> (mutation: default href to \"#\" instead of null -> FAILS)", () => {
    const out = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [], waiting: [transfer("c1", null, "9565551212")] },
      accountId: "a1", contactNames: {}, timezone: "America/Chicago", tr: makeTr("en"),
    }));
    const row = out.split("<li").slice(1).find((r) => r.includes("9565551212"))!;
    expect(row).not.toMatch(/<a\s/);
    expect(row).toMatch(/<div[^>]*data-work-row-link/);
  });
});
