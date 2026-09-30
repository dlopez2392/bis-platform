import { describe, it, expect } from "vitest";
import { segmentsFor } from "@/lib/sms/segments";
import { withOptOut } from "@/lib/sms/opt-out";
import { withTrailingLink } from "./sms-link";
import { composeReviewRequestSms } from "./review-request-copy";
import { defaultNoShowNudgeBody, composeNoShowNudgeSms } from "./no-show-nudge-copy";

const URL = "https://app.example.com/b/cal_pub_1";

describe("withTrailingLink — the ONE place a link is appended to an SMS", () => {
  it("is the trimmed body, one space, the trimmed link; either alone when the other is empty", () => {
    expect(withTrailingLink("  Book here:  ", ` ${URL} `)).toBe(`Book here: ${URL}`);
    expect(withTrailingLink("Book here:", "")).toBe("Book here:");
    expect(withTrailingLink("", URL)).toBe(URL);
  });

  it("is what both composers are made of — the review composer's own tests stay the proof for its side", () => {
    expect(composeReviewRequestSms("Review us:", URL)).toBe(withTrailingLink("Review us:", URL));
    expect(composeNoShowNudgeSms("Rebook:", URL)).toBe(withTrailingLink("Rebook:", URL));
  });
});

describe("defaultNoShowNudgeBody", () => {
  it("names the company, so a text from an unknown number does not read as spam", () => {
    expect(defaultNoShowNudgeBody("Rio Roofing"))
      .toBe("We missed you at your appointment with Rio Roofing. Pick a new time here:");
  });

  it("drops the identifying clause for a blank name instead of inventing one", () => {
    expect(defaultNoShowNudgeBody("   "))
      .toBe("We missed you at your appointment. Pick a new time here:");
  });

  it("inserts a name containing $ patterns literally", () => {
    expect(defaultNoShowNudgeBody("A$&B")).toContain("with A$&B.");
  });

  it("MEASURED: the default plus a booking-page link is ONE GSM-7 segment for a GSM-7 name", () => {
    // Mutation: count the body alone and this still passes — which is why the
    // page's counter test in automations.spec.ts feeds the composed string.
    const s = segmentsFor(composeNoShowNudgeSms(defaultNoShowNudgeBody("Rio Roofing"), URL));
    expect(s.encoding).toBe("gsm7");
    expect(s.segments).toBe(1);
    expect(s.chars).toBe(109);
  });

  // A REAL link's shape: APP_ORIGIN (.env.example) + `/b/` + a 12-character
  // id from forms.ts's ALPHABET, 38 characters.
  const REAL_LINK = "https://app.bis-rgv.com/b/k7m2p9q4x3wz";

  it("MEASURED: the SENT string — default, a real booking link, opt-out disclosure — is 135 septets, ONE segment", () => {
    // `sendAutomationSms` appends `withOptOut` unconditionally
    // (send-sms.ts:82), English because this pass passes no `language`.
    // Measured with the real functions: 112 septets composed, 135 disclosed.
    // Mutation: make `withOptOut` return the body undisclosed → this reds.
    const s = segmentsFor(withOptOut(composeNoShowNudgeSms(defaultNoShowNudgeBody("Rio Roofing"), REAL_LINK)));
    expect(s).toEqual({ encoding: "gsm7", chars: 135, segments: 1 });
  });

  it("MEASURED budget: on a real 38-character link, ONE segment for any GSM-7 name up to 36 characters, TWO at 37", () => {
    // 36 characters is exactly 160 septets disclosed; one more is 161. The
    // old default ("We missed you for your appointment… If you'd like to pick
    // a new time, book here:") crossed at 13, which put "Valley Air
    // Conditioning" (171) on two billed messages; it is 147 now. A longer
    // origin than app.bis-rgv.com takes its extra characters out of this
    // budget one for one, which is why the card renders the real count.
    // Mutation: restore the old default → the 36-character half reds.
    const at = (n: number) =>
      segmentsFor(withOptOut(composeNoShowNudgeSms(defaultNoShowNudgeBody("x".repeat(n)), REAL_LINK)));
    expect(at(36)).toEqual({ encoding: "gsm7", chars: 160, segments: 1 });
    expect(at(37)).toEqual({ encoding: "gsm7", chars: 161, segments: 2 });
    expect(segmentsFor(withOptOut(composeNoShowNudgeSms(defaultNoShowNudgeBody(""), REAL_LINK))))
      .toEqual({ encoding: "gsm7", chars: 118, segments: 1 });
  });

  it("MEASURED: an accented company name flips the whole SENT message to UCS-2 and bills THREE segments", () => {
    // "García" is the common case on this platform, not an edge case. The
    // shorter default is 115 UTF-16 units composed (two segments of 67), and
    // the disclosure takes it to 138 — three. Measured on what is billed,
    // not on the composed body, because the counter shows the billed count.
    const s = segmentsFor(withOptOut(composeNoShowNudgeSms(defaultNoShowNudgeBody("García Roofing"), REAL_LINK)));
    expect(s).toEqual({ encoding: "ucs2", chars: 138, segments: 3 });
  });
});
