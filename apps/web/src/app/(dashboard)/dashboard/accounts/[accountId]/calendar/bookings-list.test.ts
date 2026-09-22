import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BookingRow } from "@bis/db";
import { m } from "@/lib/messages";
import { BookingsList } from "./bookings-list";

/**
 * This component had NO test before part B (the directory held only
 * `actions.test.ts` and `hours-form.test.ts`), so the confirmation pill's
 * only coverage would otherwise have been a reader's eye.
 *
 * `renderToStaticMarkup` inside a plain `.test.ts` is the house way to render
 * a component here — there is not one `.test.tsx` in `apps/web/src`, and the
 * automations page test (`automations/page.test.ts:2`) does exactly this.
 * `BookingsList` is `"use client"` and calls `useTransition`, which
 * server-renders as `[false, noop]`.
 */

type Booking = BookingRow & { contact_name: string; contact_email: string | null };

const BASE: Booking = {
  id: "bk_1", account_id: "a1", calendar_id: "cal_1", contact_id: "c1",
  starts_at: "2026-10-01T15:00:00Z", ends_at: "2026-10-01T16:00:00Z",
  status: "booked", note: null, cancel_token: "tok", booker_timezone: null,
  reminder_sent_at: null, meeting_url: null, followup_sent_at: null,
  review_requested_at: null, completed_at: null, no_show_at: null,
  no_show_nudged_at: null, sms_reminder_sent_at: null,
  review_request_sms_failed_at: null, no_show_nudge_sms_failed_at: null,
  sms_reminder_failed_at: null,
  confirm_reply: null, confirm_reply_at: null,
  contact_name: "Ana Reyes", contact_email: "ana@example.com",
};

function render(booking: Booking): string {
  return renderToStaticMarkup(
    BookingsList({
      accountId: "a1", timezone: "America/Chicago", bookings: [booking],
      statusAction: async () => ({ ok: true }),
    }),
  );
}

describe("BookingsList — the confirmation answer", () => {
  it("shows the customer's YES as a sentence, with a dot beside it", () => {
    const html = render({ ...BASE, confirm_reply: "yes", confirm_reply_at: "2026-09-29T15:05:00Z" });
    expect(html).toContain(m["calendar.bookings.confirmed"]);
    // DOT AND WORD, never colour alone (DESIGN.md rule 3). Mutation: delete the
    // aria-hidden dot span -> this reds by name.
    //
    // The dot is bound to be the pill's FIRST CHILD rather than merely
    // "somewhere after the testid". A lazy any-character run before
    // `aria-hidden` is satisfied by any aria-hidden element ANYWHERE later in
    // the document: there happens to be exactly one in this markup today, so
    // that form does red now, but the first decorative icon added to a button
    // below would let it pass with the dot deleted. That is the "assertion
    // satisfied by an adjacent element" shape this repo keeps shipping.
    expect(html).toMatch(/data-testid="booking-confirm-reply"[^>]*><span aria-hidden="true"/);
  });

  it("shows a NO as the operator-facing sentence, not the raw word", () => {
    const html = render({ ...BASE, confirm_reply: "no", confirm_reply_at: "2026-09-29T15:05:00Z" });
    expect(html).toContain(m["calendar.bookings.confirmDeclined"]);
    expect(html).not.toContain(m["calendar.bookings.confirmed"]);
    expect(html).toMatch(/data-testid="booking-confirm-reply"[^>]*><span aria-hidden="true"/);
  });

  it("shows no pill at all when nobody has answered", () => {
    const html = render(BASE);
    expect(html).not.toContain(m["calendar.bookings.confirmed"]);
    expect(html).not.toContain(m["calendar.bookings.confirmDeclined"]);
    expect(html).not.toContain("booking-confirm-reply");
    // The row itself still rendered — otherwise the three negatives above
    // would hold for an empty string.
    expect(html).toContain("Ana Reyes");
  });
});
