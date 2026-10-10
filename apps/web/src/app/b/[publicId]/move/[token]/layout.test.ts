import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const m = vi.hoisted(() => ({ loadMoveContextSafe: vi.fn(), loadCalendarSafe: vi.fn(), loadCalendarBranding: vi.fn() }));
vi.mock("./data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./data")>()), loadMoveContextSafe: m.loadMoveContextSafe,
}));
vi.mock("../../data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../data")>()),
  loadCalendarSafe: m.loadCalendarSafe, loadCalendarBranding: m.loadCalendarBranding,
}));

import { newCancelToken } from "@bis/db";
import MoveSegmentLayout from "./layout";

/**
 * D-109's rule, for the move link (F-048): a link that names a REAL calendar
 * but no booking of it (a truncated or mistyped token) is a dead end in that
 * business's brand; an id that never existed stays neutral; a working link
 * passes straight through (the page draws its own header). A malformed token
 * is never looked up.
 */
const SENTINEL = "__dead_end_body__";
const TOKEN = newCancelToken();
const params = (token = TOKEN) => Promise.resolve({ publicId: "p1", token });
const BRAND = {
  brandName: "Acme Plumbing", brandLogoPath: null, brandColor: "#2563eb", brandNeutral: "cool",
  brandCorners: "round", brandType: "inter", brandMode: "light", replyToEmail: null,
};

beforeEach(() => {
  m.loadMoveContextSafe.mockReset();
  m.loadCalendarSafe.mockReset().mockResolvedValue({ id: "cal1", account_id: "a1", public_id: "p1", enabled: true });
  m.loadCalendarBranding.mockReset().mockResolvedValue(BRAND);
});

describe("the move page's segment layout (D-109)", () => {
  it("a working link passes straight through and reads no calendar or brand", async () => {
    m.loadMoveContextSafe.mockResolvedValue({ row: { id: "bk1" }, calendar: { public_id: "p1" } });
    expect(await MoveSegmentLayout({ params: params(), children: SENTINEL })).toBe(SENTINEL);
    expect(m.loadCalendarSafe).not.toHaveBeenCalled();
  });

  it("an unknown token, or a malformed one (never looked up), under a real calendar is branded (mutation: pass a malformed token through → it is read, FAILS)", async () => {
    m.loadMoveContextSafe.mockResolvedValue(null);
    for (const token of [TOKEN, "not-a-token"]) {
      const html = renderToStaticMarkup((await MoveSegmentLayout({ params: params(token), children: SENTINEL })) as ReactElement);
      expect(html).toContain("data-booking-dead-end");
      expect(html).toContain("Acme Plumbing");
      expect(html).toContain(SENTINEL);
    }
    expect(m.loadMoveContextSafe).toHaveBeenCalledTimes(1);
  });

  it("a booking of ANOTHER calendar under this id is this calendar's dead end, not a pass-through", async () => {
    m.loadMoveContextSafe.mockResolvedValue({ row: { id: "bk1" }, calendar: { public_id: "elsewhere" } });
    const html = renderToStaticMarkup((await MoveSegmentLayout({ params: params(), children: SENTINEL })) as ReactElement);
    expect(html).toContain("data-booking-dead-end");
  });

  it("an id that never existed stays neutral", async () => {
    m.loadMoveContextSafe.mockResolvedValue(null);
    m.loadCalendarSafe.mockResolvedValue(null);
    expect(await MoveSegmentLayout({ params: params(), children: SENTINEL })).toBe(SENTINEL);
    expect(m.loadCalendarBranding).not.toHaveBeenCalled();
  });
});
