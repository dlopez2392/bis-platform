import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const { getCalendarByPublicIdMock, getBrandingMock } = vi.hoisted(() => ({
  getCalendarByPublicIdMock: vi.fn(),
  getBrandingMock: vi.fn(),
}));
vi.mock("@bis/db", async () => ({
  ...(await vi.importActual<typeof import("@bis/db")>("@bis/db")),
  serviceDb: () => ({}),
  getCalendarByPublicId: getCalendarByPublicIdMock,
  getBranding: getBrandingMock,
  brandLogoUrl: (p: string) => `https://cdn.example/${p}`,
}));

import BookingSegmentLayout from "./layout";

/**
 * D-109: the booking page's dead end wears the business's brand when the
 * link names a REAL calendar that is switched off, and stays neutral when
 * the id never existed (the split `/f` and `/c` already draw; see
 * `app/f/[publicId]/layout.tsx`). Where this layout sits in the tree, so
 * that it actually wraps the not-found, is pinned by `app/b/dead-ends.test.ts`.
 */
const SENTINEL = "__dead_end_body__";
const CALENDAR = { id: "cal1", account_id: "a1", public_id: "p1", enabled: false };
const BRAND = {
  brandName: "Acme Plumbing", brandLogoPath: "a1/logo.png",
  brandColor: "#2563eb", brandNeutral: "cool", brandCorners: "round",
  brandType: "inter", brandMode: "light", replyToEmail: null,
};
const params = Promise.resolve({ publicId: "p1" });

beforeEach(() => {
  getCalendarByPublicIdMock.mockReset();
  getBrandingMock.mockReset();
});

describe("the booking page's segment layout (D-109)", () => {
  it("brands the dead end of a real, switched-off calendar: logo, name and the account's own theme", async () => {
    getCalendarByPublicIdMock.mockResolvedValue(CALENDAR);
    getBrandingMock.mockResolvedValue(BRAND);
    const html = renderToStaticMarkup(
      (await BookingSegmentLayout({ params, children: SENTINEL })) as ReactElement,
    );
    expect(html).toContain("data-booking-dead-end");
    expect(html).toContain("Acme Plumbing");
    expect(html).toContain("https://cdn.example/a1/logo.png");
    expect(html).toContain("--accent:");
    expect(html).toContain(SENTINEL);
    expect(getBrandingMock).toHaveBeenCalledWith({}, "a1");
  });

  it("a LIVE calendar passes straight through and reads no branding (no extra query on the happy path)", async () => {
    getCalendarByPublicIdMock.mockResolvedValue({ ...CALENDAR, enabled: true });
    expect(await BookingSegmentLayout({ params, children: SENTINEL })).toBe(SENTINEL);
    expect(getBrandingMock).not.toHaveBeenCalled();
  });

  it("an id that never existed stays neutral", async () => {
    getCalendarByPublicIdMock.mockResolvedValue(null);
    expect(await BookingSegmentLayout({ params, children: SENTINEL })).toBe(SENTINEL);
    expect(getBrandingMock).not.toHaveBeenCalled();
  });

  it("a failed calendar read stays neutral rather than throwing (the page's own read reaches error.tsx)", async () => {
    getCalendarByPublicIdMock.mockRejectedValue(new Error("db down"));
    expect(await BookingSegmentLayout({ params, children: SENTINEL })).toBe(SENTINEL);
  });

  it("a failed branding read stays neutral too", async () => {
    getCalendarByPublicIdMock.mockResolvedValue(CALENDAR);
    getBrandingMock.mockRejectedValue(new Error("db down"));
    expect(await BookingSegmentLayout({ params, children: SENTINEL })).toBe(SENTINEL);
  });
});
