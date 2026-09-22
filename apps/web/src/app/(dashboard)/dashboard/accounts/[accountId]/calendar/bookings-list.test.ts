import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BookingRow } from "@bis/db";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { STATUS_TREATMENTS } from "@/lib/automations/log-titles";
import { BookingsList } from "./bookings-list";

/**
 * This component had NO test before part B (the directory held only
 * `actions.test.ts` and `hours-form.test.ts`), so the confirmation pill's
 * only coverage would otherwise have been a reader's eye.
 *
 * `renderToStaticMarkup` inside a plain `.test.ts` is the house way to render
 * a component here — there is not one `.test.tsx` in `apps/web/src`, and
 * `vitest.config.ts` includes only `src/**` + `'/*.test.ts'`, so JSX does not
 * parse in this file. `createElement`, not a direct call: `BookingsList` is
 * `"use client"`, and the direct-call precedent (`automations/page.test.ts`)
 * is an ASYNC SERVER component, where a direct call is the only option. A
 * plain function call works here only for as long as the component has no
 * hooks; the first `useState` added to its body would throw, and the
 * component already renders `StatusActions`, which calls `useTransition`.
 * `activity-table.test.ts:18`, `usage-card.test.ts:7` and
 * `sms-reminder-card.test.ts:29` are the client-component form.
 *
 * Copy is asserted against `renderedText(html)`, never raw markup: React
 * escapes an apostrophe to `&#x27;`, and a NEGATIVE assertion on a string
 * containing one can never fail (see `lib/rendered-text.ts`, which exists
 * because this repo hit that twice). Three of the assertions below are
 * negatives, and both pill strings are apostrophe-free TODAY — one copy edit
 * to "They asked for a different time" and the raw-markup form would have
 * silently stopped testing anything.
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
    createElement(BookingsList, {
      accountId: "a1", timezone: "America/Chicago", bookings: [booking],
      statusAction: async () => ({ ok: true as const }),
    }),
  );
}

/**
 * The pill's own opening tag and its FIRST CHILD, or a throw naming what is
 * missing. `[^>]*` cannot cross a `>`, so the dot has to be the element
 * immediately inside the pill — not merely "somewhere after the testid". A
 * lazy any-character run would be satisfied by any `aria-hidden` element
 * anywhere later in the document: there happens to be exactly one in this
 * markup today, so that form does red now, but the first decorative icon
 * added to a button below would let it pass with the dot deleted. That is
 * the "assertion satisfied by an adjacent element" shape this repo keeps
 * shipping.
 */
function pill(html: string): { tag: string; dot: string } {
  const match = html.match(
    /(<span[^>]*data-testid="booking-confirm-reply"[^>]*>)(<span[^>]*aria-hidden="true"[^>]*>)/);
  if (!match) throw new Error("no confirmation pill whose FIRST child is the aria-hidden dot");
  return { tag: match[1]!, dot: match[2]! };
}

describe("BookingsList — the confirmation answer", () => {
  it("shows the customer's YES as a sentence, with a dot beside it", () => {
    const html = render({ ...BASE, confirm_reply: "yes", confirm_reply_at: "2026-09-29T15:05:00Z" });
    expect(renderedText(html)).toContain(m["calendar.bookings.confirmed"]);
    // DOT AND WORD, never colour alone (DESIGN.md rule 3). Mutation: delete
    // the aria-hidden dot span -> `pill()` throws and this reds by name.
    pill(html);
  });

  it("shows a NO as the operator-facing sentence, not the raw word", () => {
    const html = render({ ...BASE, confirm_reply: "no", confirm_reply_at: "2026-09-29T15:05:00Z" });
    const text = renderedText(html);
    expect(text).toContain(m["calendar.bookings.confirmDeclined"]);
    expect(text).not.toContain(m["calendar.bookings.confirmed"]);
    pill(html);
  });

  it("shows no pill at all when nobody has answered", () => {
    const html = render(BASE);
    const text = renderedText(html);
    expect(text).not.toContain(m["calendar.bookings.confirmed"]);
    expect(text).not.toContain(m["calendar.bookings.confirmDeclined"]);
    expect(html).not.toContain("booking-confirm-reply");
    // The row itself still rendered — otherwise the three negatives above
    // would hold for an empty string.
    expect(text).toContain("Ana Reyes");
  });

  /**
   * A cancelled booking whose customer had already said yes STILL shows the
   * pill, and that is deliberate: "they confirmed, and then it was cancelled"
   * is a true thing and arguably the most useful row on the screen. It was an
   * implicit decision with no test — the pill is rendered outside
   * `StatusActions`, which is the only thing on the row that gates on
   * `status === "booked"`.
   *
   * Mutation: add `&& b.status === "booked"` to the pill's condition -> this
   * reds by name while the three tests above stay green.
   */
  it("still shows the answer on a CANCELLED booking — confirmed, then cancelled, is worth seeing", () => {
    const html = render({
      ...BASE, status: "cancelled",
      confirm_reply: "yes", confirm_reply_at: "2026-09-29T15:05:00Z",
    });
    const text = renderedText(html);
    expect(text).toContain(m["calendar.bookings.status.cancelled"]);
    expect(text).toContain(m["calendar.bookings.confirmed"]);
    pill(html);
  });

  /**
   * The pill IS a `Badge`, and its colours ARE `STATUS_TREATMENTS` — not a
   * partial reimplementation that matches by eye. The hand-rolled version
   * this replaced carried `inline-flex items-center gap-1.5 rounded-full
   * border px-2 py-0.5 text-xs` and so was missing the badge's `font-medium`,
   * `w-fit`, `shrink-0` and `whitespace-nowrap`: it rendered at normal weight
   * beside the `font-medium` status badge on the same row, and could wrap
   * where that badge cannot. Asserting the four names is what stops a future
   * copy-paste from drifting back.
   *
   * Class NAMES are checked one at a time rather than as one substring,
   * because `cn` is tailwind-merge — it drops the losers of a conflict (the
   * chip variant's own `border-`/`bg-`/`text-` lose to these) and the
   * survivors are not guaranteed to stay contiguous.
   */
  it("is the real Badge with the real STATUS_TREATMENTS colours — yes takes `sent`, no takes `skipped`", () => {
    const yes = pill(render({ ...BASE, confirm_reply: "yes", confirm_reply_at: "2026-09-29T15:05:00Z" }));
    expect(yes.tag).toContain('data-slot="badge"');
    expect(yes.tag).toContain('data-variant="chip"');
    for (const cls of ["w-fit", "shrink-0", "font-medium", "whitespace-nowrap"]) {
      expect(yes.tag).toContain(cls);
    }
    for (const cls of STATUS_TREATMENTS.sent.chip.split(" ")) expect(yes.tag).toContain(cls);
    expect(yes.dot).toContain("size-[7px]");
    expect(yes.dot).toContain(STATUS_TREATMENTS.sent.dot);

    const no = pill(render({ ...BASE, confirm_reply: "no", confirm_reply_at: "2026-09-29T15:05:00Z" }));
    for (const cls of STATUS_TREATMENTS.skipped.chip.split(" ")) expect(no.tag).toContain(cls);
    expect(no.dot).toContain(STATUS_TREATMENTS.skipped.dot);
  });
});
