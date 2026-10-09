import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { SubmissionsTable } from "./submissions-table";

/**
 * A submission's own `created_at` (and a consent entry's own `at`) rendered
 * through `formatDateTime` — the RUNTIME's zone (server or browser), never
 * the account's — the same bug D-010 fixed for the contacts list and the
 * activity timeline.
 */
/** `consentAt` defaults to "" (no consent entry rendered at all — the
 *  `entries.length === 0` early-return in `ConsentList`) so the plain
 *  submission-date test below exercises exactly what it says and nothing
 *  else. */
function submission(createdAt: string, consentAt = "") {
  return {
    id: "s1", form_id: "f1", contact_id: null, spam_reason: null, processing_error: null,
    answers: [],
    consent: consentAt
      ? [{ key: "marketing", given: true, text: "I agree to be contacted", at: consentAt }]
      : [],
    created_at: createdAt,
  };
}

function html(createdAt: string, timezone: string, consentAt = ""): string {
  return renderToStaticMarkup(createElement(SubmissionsTable, {
    accountId: "a1", submissions: [submission(createdAt, consentAt)] as never, timezone,
  } as never));
}

describe("SubmissionsTable's row timestamp renders in the ACCOUNT's zone, not the runtime's", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("a submission's clock time follows the account's zone (Berlin), not the runtime's (Chicago)", () => {
    vi.stubEnv("TZ", "America/Chicago");
    const text = renderedText(html("2026-10-08T05:00:00.000Z", "Europe/Berlin"));
    // 05:00 UTC is 7:00 AM in Berlin but 12:00 AM (midnight) in Chicago.
    expect(text).toContain("7:00 AM");
    expect(text).not.toContain("12:00 AM");
  });

  // Review of #225: the submission date above was tested, but a consent
  // entry's own `at` (submissions-table.tsx:104, the SAME `timezone` prop
  // feeding a SEPARATE formatter call inside `ConsentList`) was not —
  // `consent: []` on every fixture meant `ConsentList` returned `null`
  // before that line ever ran, so a dropped zone there could not fail any
  // existing test (mutation: hardcode `timezone="UTC"` at line 104 → FAILS).
  it("a consent entry's own 'at' ALSO follows the account's zone (Berlin), not the runtime's (Chicago)", () => {
    vi.stubEnv("TZ", "America/Chicago");
    const text = renderedText(html(
      "2026-01-01T00:00:00.000Z", "Europe/Berlin", "2026-10-08T05:00:00.000Z",
    ));
    // Same instant as the submission-date case above, carried by the
    // CONSENT entry's `at` this time: 05:00 UTC is 7:00 AM in Berlin but
    // 12:00 AM (midnight) in Chicago.
    expect(text).toContain("7:00 AM");
    expect(text).not.toContain("12:00 AM");
  });
});
