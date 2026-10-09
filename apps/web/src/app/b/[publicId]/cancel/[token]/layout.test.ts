import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const { lookupBookingByTokenMock, getCalendarByPublicIdMock, getBrandingMock } = vi.hoisted(() => ({
  lookupBookingByTokenMock: vi.fn(),
  getCalendarByPublicIdMock: vi.fn(),
  getBrandingMock: vi.fn(),
}));
vi.mock("./actions", () => ({ lookupBookingByToken: lookupBookingByTokenMock }));
vi.mock("@bis/db", async () => ({
  ...(await vi.importActual<typeof import("@bis/db")>("@bis/db")),
  serviceDb: () => ({}),
  getCalendarByPublicId: getCalendarByPublicIdMock,
  getBranding: getBrandingMock,
  brandLogoUrl: (p: string) => `https://cdn.example/${p}`,
}));

import CancelSegmentLayout from "./layout";

/**
 * D-109, the cancel link's half. A cancel link whose token matches nothing
 * (truncated by a mail client, mistyped) under a REAL calendar's id is a dead
 * end in that business's brand; under an id that never existed it stays
 * neutral. A WORKING link passes straight through: the page draws its own
 * brand header, and the only read here is the token lookup the page makes
 * anyway (shared through `./data.ts`'s `cache()`), so the happy path costs
 * no extra query.
 */
const SENTINEL = "__dead_end_body__";
const params = Promise.resolve({ publicId: "p1", token: "tok" });
const BRAND = {
  brandName: "Acme Plumbing", brandLogoPath: null,
  brandColor: "#2563eb", brandNeutral: "cool", brandCorners: "round",
  brandType: "inter", brandMode: "light", replyToEmail: null,
};

beforeEach(() => {
  lookupBookingByTokenMock.mockReset();
  getCalendarByPublicIdMock.mockReset();
  getBrandingMock.mockReset();
});

describe("the cancel page's segment layout (D-109)", () => {
  it("a working link passes straight through and reads nothing beyond the token (no extra query)", async () => {
    lookupBookingByTokenMock.mockResolvedValue({ id: "bk1", account_id: "a1", status: "booked" });
    expect(await CancelSegmentLayout({ params, children: SENTINEL })).toBe(SENTINEL);
    expect(getCalendarByPublicIdMock).not.toHaveBeenCalled();
    expect(getBrandingMock).not.toHaveBeenCalled();
  });

  it("an unknown token under a real calendar is branded", async () => {
    lookupBookingByTokenMock.mockResolvedValue(null);
    getCalendarByPublicIdMock.mockResolvedValue({ id: "cal1", account_id: "a1", public_id: "p1", enabled: true });
    getBrandingMock.mockResolvedValue(BRAND);
    const html = renderToStaticMarkup(
      (await CancelSegmentLayout({ params, children: SENTINEL })) as ReactElement,
    );
    expect(html).toContain("data-booking-dead-end");
    expect(html).toContain("Acme Plumbing");
    expect(html).toContain(SENTINEL);
    expect(getCalendarByPublicIdMock).toHaveBeenCalledWith({}, "p1");
  });

  it("an unknown token under an id that never existed stays neutral", async () => {
    lookupBookingByTokenMock.mockResolvedValue(null);
    getCalendarByPublicIdMock.mockResolvedValue(null);
    expect(await CancelSegmentLayout({ params, children: SENTINEL })).toBe(SENTINEL);
    expect(getBrandingMock).not.toHaveBeenCalled();
  });
});
