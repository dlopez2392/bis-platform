import { describe, it, expect } from "vitest";
import { segmentsFor } from "@/lib/sms/segments";
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
      .toBe("We missed you for your appointment with Rio Roofing. If you'd like to pick a new time, book here:");
  });

  it("drops the identifying clause for a blank name instead of inventing one", () => {
    expect(defaultNoShowNudgeBody("   "))
      .toBe("We missed you for your appointment. If you'd like to pick a new time, book here:");
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
    expect(s.chars).toBe(133);
  });

  it("MEASURED: an accented company name flips the whole message to UCS-2 and costs THREE segments", () => {
    // "García" is the common case on this platform, not an edge case, and
    // this message is long enough that the flip costs three. The counter
    // has to show that.
    const s = segmentsFor(composeNoShowNudgeSms(defaultNoShowNudgeBody("García Roofing"), URL));
    expect(s.encoding).toBe("ucs2");
    expect(s.segments).toBe(3);
  });
});
