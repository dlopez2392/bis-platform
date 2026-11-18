import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { CheckinCountsStates, CHECKIN_COUNTS_DEMOS } from "./checkin-counts-states";

describe("styleguide: the check-in counts line (F-072 PR 4)", () => {
  const html = renderToStaticMarkup(createElement(CheckinCountsStates));

  it("shows the line once per state: a skeleton plus three real ones (mutation: drop a state -> FAILS)", () => {
    expect(CHECKIN_COUNTS_DEMOS).toHaveLength(4);
    expect(html.match(/data-testid="review-checkin-counts-loading"/g)).toHaveLength(1);
    expect(html.match(/data-testid="review-checkin-counts"/g)).toHaveLength(3);
  });

  it("each state says its own words, and the error state shows no numbers", () => {
    const t = renderedText(html);
    for (const key of ["automations.review.counts.empty", "automations.review.counts.error", "automations.review.counts.note"] as const) {
      expect(t, key).toContain(m[key]);
    }
    expect(t).toContain("9 asked, 6 answered (3 great, 2 okay, 1 not great). 4 opened the review link.");
  });

  it("every column can shrink on a phone (min-w-0, w-full), so the page never widens (mutation: drop min-w-0 -> FAILS)", () => {
    expect(html.match(/class="flex w-full max-w-md min-w-0 flex-col/g)).toHaveLength(4);
    expect(html).toMatch(/^<div class="flex w-full min-w-0 flex-wrap/);
  });
});
