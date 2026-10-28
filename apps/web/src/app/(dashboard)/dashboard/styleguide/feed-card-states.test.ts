import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

const { FeedCardStates, FEED_CARD_DEMOS } = await import("./feed-card-states");
const here = path.dirname(fileURLToPath(import.meta.url));

describe("styleguide: the Bookings on your phone card (F-048 part 2, final review I2)", () => {
  const html = renderToStaticMarkup(createElement(FeedCardStates));
  const cards = html.split("data-feed-card").slice(1).map((chunk) => renderedText(chunk));

  it("shows the REAL card once per state, in the reviewed order (mutation: drop a demo → FAILS)", () => {
    expect(FEED_CARD_DEMOS.map((d) => d.id)).toEqual(
      ["none", "live", "live-technician", "live-never-checked", "stale", "agency", "unavailable", "error"],
    );
    expect(cards).toHaveLength(8);
  });

  it("each state says its own sentence", () => {
    const want = [
      m["calendar.feed.empty"], m["calendar.feed.private"], m["calendar.feed.technician"], m["calendar.feed.neverChecked"],
      m["calendar.feed.stale"], m["calendar.feed.agency"], m["calendar.feed.unavailable"], m["calendar.feed.loadError"],
    ];
    want.forEach((s, i) => expect(cards[i], FEED_CARD_DEMOS[i]!.id).toContain(s));
    expect(cards[1]).toContain(m["calendar.feed.lastChecked"].split(" {when}")[0]!);
    expect(cards[1]).not.toContain(m["calendar.feed.technician"]);
  });

  it("the long link sits in the card's Input (w-full min-w-0, scrolls inside), never as bare text that would overflow 375px", () => {
    const inputs = [...html.matchAll(/<input[^>]*>/g)].map((x) => x[0]);
    expect(inputs).toHaveLength(3);   // the three live states
    for (const i of inputs) {
      expect(i).toMatch(/\bw-full\b/);
      expect(i).toMatch(/\bmin-w-0\b/);
      expect(i).toMatch(/value="https:\/\/app\.bis-rgv\.com\/cal\/[A-Za-z0-9_-]{43}\.ics"/);
    }
    // Each demo is a column capped at max-w-md and w-full, so a 375px viewport shrinks it rather than scrolls the page.
    expect(html.match(/flex w-full max-w-md min-w-0 flex-col/g)).toHaveLength(8);
  });

  it("the styleguide page mounts it", () => {
    expect(readFileSync(path.join(here, "page.tsx"), "utf8")).toMatch(/<FeedCardStates\s*\/>/);
  });
});
