import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutomationLogListRow } from "@bis/db";
import { renderedText } from "@/lib/rendered-text";
import { ActivityTable, PAGE_SIZE } from "./activity-table";

// `.test.ts`, not `.tsx`: vitest.config.ts includes only `src/**/*.test.ts`, so JSX does not parse here — createElement, as calls-table.test.ts does.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const AT = "2026-09-22T13:05:00.000Z";
const row = (o: Partial<AutomationLogListRow>): AutomationLogListRow => ({
  id: "00000000-0000-4000-8000-000000000001", account_id: "acct_1", source: "sms_reminder", channel: "sms", contact_id: "ct_1",
  subject_key: "booking:1", status: "sent", reason: "", held_until: null, payload: {}, occurred_at: AT, contact_name: "Maria Garcia", ...o,
});
const render = (rows: AutomationLogListRow[], extra: { olderHref?: string; newerHref?: string } = {}) =>
  renderToStaticMarkup(createElement(ActivityTable, { rows, timezone: "America/Chicago", ...extra }));

describe("ActivityTable", () => {
  it("a row shows the TITLE (never the key), the contact, the channel word, the status word, and the time in the account's zone", () => {
    const html = render([row({})]);
    const text = renderedText(html);
    expect(text).toContain("Text reminders");
    expect(text).not.toContain("sms_reminder");
    expect(text).toContain("Maria Garcia");
    expect(text).toContain("8:05 AM CDT");
    expect(html).toContain('data-status="sent"');
  });

  it("the reason shows for held/skipped/failed and NOT for sent (mutation: drop the status check → FAILS)", () => {
    const skipped = render([row({ status: "skipped", reason: "No phone number we can text" })]);
    expect(renderedText(skipped)).toContain("No phone number we can text");
    const sent = render([row({ status: "sent", reason: "leftover text a sent row must never show" })]);
    expect(renderedText(sent)).not.toContain("leftover text");
    expect(sent).not.toContain("data-log-reason");
  });

  it("a row with no contact shows a dash; an assistant row says Assistant (mutation: drop the ?? \"—\" fallback → FAILS)", () => {
    const text = renderedText(render([row({ contact_name: null, source: "voice", channel: "ai" })]));
    expect(text).toContain("Phone assistant");
    expect(text).toContain("Assistant");
    expect(text).toContain("—");
  });

  it("the pager renders exactly the links it is given, and none when it is given none", () => {
    expect(render([row({})])).not.toContain("aria-label=\"Pages\"");
    const html = render([row({})], { olderHref: "/a?before=x", newerHref: "/a" });
    expect(html).toContain('href="/a?before=x"');
    expect(html).toContain('href="/a"');
    expect(renderedText(html)).toContain("Older");
    expect(renderedText(html)).toContain("Newer");
  });

  it("PAGE_SIZE is the spec's 25", () => { expect(PAGE_SIZE).toBe(25); });
});
