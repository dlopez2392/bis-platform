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
function submission(createdAt: string) {
  return {
    id: "s1", form_id: "f1", contact_id: null, spam_reason: null, processing_error: null,
    answers: [], consent: [], created_at: createdAt,
  };
}

function html(createdAt: string, timezone: string): string {
  return renderToStaticMarkup(createElement(SubmissionsTable, {
    accountId: "a1", submissions: [submission(createdAt)] as never, timezone,
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
});
