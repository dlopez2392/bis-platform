import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

const { GoogleCardStates, GOOGLE_CARD_DEMOS } = await import("./google-card-states");

describe("styleguide: the Google Calendar card (S-22 slice 1, PR 3)", () => {
  const html = renderToStaticMarkup(createElement(GoogleCardStates));

  it("shows the real card once per state plus the skeleton", () => {
    expect(GOOGLE_CARD_DEMOS).toHaveLength(9);
    expect(html.match(/data-google-card="true"/g)).toHaveLength(8);
    expect(html.match(/data-google-card-skeleton/g)).toHaveLength(1);
  });

  it("each state says its own words", () => {
    const t = renderedText(html);
    for (const key of [
      "calendar.google.empty", "calendar.google.connected.note", "calendar.google.needsReconnect.body",
      "calendar.google.outcome.denied", "calendar.google.paused", "calendar.google.loadError",
    ] as const) expect(t, key).toContain(m[key]);
    expect(t).toContain("To connect, open this page at https://app.bis-rgv.com.");
  });
});
