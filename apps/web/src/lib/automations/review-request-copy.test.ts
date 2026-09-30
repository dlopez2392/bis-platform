import { describe, it, expect } from "vitest";
import { segmentsFor } from "@/lib/sms/segments";
import { withOptOut } from "@/lib/sms/opt-out";
import { defaultReviewRequestBody, composeReviewRequestSms } from "./review-request-copy";

const URL = "https://g.page/r/CXyZ123abc/review";

describe("composeReviewRequestSms — the ONE place the link is appended", () => {
  it("is the trimmed body, one space, the trimmed url", () => {
    expect(composeReviewRequestSms("  Please review us:  ", ` ${URL} `)).toBe(`Please review us: ${URL}`);
  });

  it("with no url yet, is just the body — what the settings counter shows before the link is typed", () => {
    expect(composeReviewRequestSms("Please review us:", "")).toBe("Please review us:");
    expect(composeReviewRequestSms("", URL)).toBe(URL);
  });
});

describe("defaultReviewRequestBody", () => {
  it("names the company, so a text from an unknown number does not read as spam", () => {
    expect(defaultReviewRequestBody("Rio Roofing"))
      .toBe("Thanks for choosing Rio Roofing! If you have a minute, we'd love a quick review:");
  });

  it("drops the identifying clause for a blank name instead of inventing one", () => {
    expect(defaultReviewRequestBody("   ")).toBe("Thanks for choosing us! If you have a minute, we'd love a quick review:");
  });

  it("inserts a name containing $ patterns literally", () => {
    expect(defaultReviewRequestBody("A$&B")).toContain("choosing A$&B!");
  });

  it("MEASURED: the default plus a real Google review link is ONE GSM-7 segment for a GSM-7 name", () => {
    // Measured, not assumed — this is the number the settings counter shows
    // and the number the client is billed for. Mutation: count the body alone
    // and this still passes, which is why the next test exists too.
    const s = segmentsFor(composeReviewRequestSms(defaultReviewRequestBody("Rio Roofing"), URL));
    expect(s.encoding).toBe("gsm7");
    expect(s.segments).toBe(1);
    expect(s.chars).toBe(115);
  });

  it("MEASURED: the SENT string — default, real review link, opt-out disclosure — is 138 septets, ONE GSM-7 segment", () => {
    // What a customer receives and the client is billed for:
    // `sendAutomationSms` appends `withOptOut` unconditionally (send-sms.ts:82)
    // and this pass passes no `language`, so English. Measured with the real
    // functions: 115 septets composed, 138 disclosed, one segment — the
    // "ONE segment" claim above still holds once disclosed, with 22 to spare.
    // Recorded, not asserted here (copy is danlo's call): the accented case
    // below is 118 UTF-16 units / 2 segments composed and 141 / THREE
    // disclosed; and a pasted 79-character writereview link puts "Rio
    // Roofing" at 160 / 1 composed, 183 / 2 disclosed.
    // Mutation: make `withOptOut` return the body undisclosed → this reds.
    const s = segmentsFor(withOptOut(composeReviewRequestSms(defaultReviewRequestBody("Rio Roofing"), URL)));
    expect(s).toEqual({ encoding: "gsm7", chars: 138, segments: 1 });
  });

  it("MEASURED: an accented company name flips the whole message to UCS-2 and costs TWO segments", () => {
    // Rio Grande Valley client names are heavily Hispanic; "García" is the
    // common case, not an edge case. The counter has to show this.
    const s = segmentsFor(composeReviewRequestSms(defaultReviewRequestBody("García Roofing"), URL));
    expect(s.encoding).toBe("ucs2");
    expect(s.segments).toBe(2);
  });
});
