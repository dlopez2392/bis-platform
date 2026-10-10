import { describe, it, expect } from "vitest";
import { bookingStrings } from "@/lib/booking/public-strings";
import { moveSuccessCopy } from "./move-form";

/**
 * F-048: the move's success screen says only what is true (D-033, the
 * booking page's rule): it claims an email only when the gate sent one, and
 * when none went, the link on the screen — the NEW booking's — is the thing
 * to keep.
 */
describe("moveSuccessCopy", () => {
  for (const locale of ["en", "es"] as const) {
    const s = bookingStrings(locale);
    const manageUrl = "https://x/b/p/cancel/new";

    it(`${locale}: a sent email is claimed, and the change-or-cancel hint links the new booking`, () => {
      expect(moveSuccessCopy(s, { manageUrl, emailSent: true }))
        .toEqual({ body: s.moveSuccessBody, hint: s.moveManageHint, hintHref: manageUrl });
    });

    it(`${locale}: no email sent → no email claimed, and the hint says to keep this link (mutation: ignore emailSent → FAILS)`, () => {
      expect(moveSuccessCopy(s, { manageUrl, emailSent: false }))
        .toEqual({ body: s.moveSuccessBodyNoEmail, hint: s.moveManageHintNoEmail, hintHref: manageUrl });
    });

    it(`${locale}: no email and no link → contact the business, nothing to click`, () => {
      expect(moveSuccessCopy(s, { manageUrl: "", emailSent: false }))
        .toEqual({ body: s.moveSuccessBodyNoEmail, hint: s.cancelHintNoEmailNoLink, hintHref: null });
    });
  }

  it("the no-email copy mentions no sent email in either language", () => {
    expect(bookingStrings("en").moveSuccessBodyNoEmail).not.toMatch(/we've sent|we sent/i);
    expect(bookingStrings("es").moveSuccessBodyNoEmail).not.toMatch(/te enviamos/i);
  });
});
