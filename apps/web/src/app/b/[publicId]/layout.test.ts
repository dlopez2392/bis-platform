import { describe, it, expect, vi, beforeEach } from "vitest";

// F-102 review round, fix 6: `/b` had no `[publicId]`-level layout at all
// before this — a not-found page was always neutral even when the
// calendar's account was perfectly knowable. This pins the new file's two
// jobs: brand/theme chrome when known-but-not-live, and catching its own
// read failure (same shape fix 1/2 require of `/f`'s and `/c`'s layouts,
// even though this one is not a root layout and cannot strand a shell).
const { getCalendarByPublicIdMock, getBrandingMock } = vi.hoisted(() => ({
  getCalendarByPublicIdMock: vi.fn(),
  getBrandingMock: vi.fn(),
}));
vi.mock("@bis/db", async () => {
  const actual = await vi.importActual<typeof import("@bis/db")>("@bis/db");
  return {
    ...actual,
    serviceDb: () => ({}),
    getCalendarByPublicId: getCalendarByPublicIdMock,
    getBranding: getBrandingMock,
    brandLogoUrl: () => null,
  };
});

import PublicBookingSegmentLayout, { generateMetadata } from "./layout";

const SENTINEL = "__children__";
const CALENDAR = { id: "cal1", account_id: "a1", enabled: false, max_advance_days: 30 };

beforeEach(() => {
  getCalendarByPublicIdMock.mockReset();
  getBrandingMock.mockReset();
});

describe("PublicBookingSegmentLayout (F-102 review round, fix 6)", () => {
  it("renders the account's brand chrome when the calendar is known but disabled", async () => {
    getCalendarByPublicIdMock.mockResolvedValue(CALENDAR);
    getBrandingMock.mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
    const el = await PublicBookingSegmentLayout({
      params: Promise.resolve({ publicId: "p1" }), children: SENTINEL,
    });
    // MUTATION: `if (!(showNotFoundBrand && branding && theme)) return
    // children;` changed to always `return children;` -- this FAILS (a
    // bare string, not a wrapping element, back out).
    expect(el).not.toBe(SENTINEL);
    expect(typeof el).toBe("object");
  });

  it("renders children bare (no chrome) when the calendar is unknown", async () => {
    getCalendarByPublicIdMock.mockResolvedValue(null);
    const el = await PublicBookingSegmentLayout({
      params: Promise.resolve({ publicId: "p1" }), children: SENTINEL,
    });
    expect(el).toBe(SENTINEL);
  });

  it("renders children bare (no chrome) when the calendar IS live — the live page paints its own", async () => {
    getCalendarByPublicIdMock.mockResolvedValue({ ...CALENDAR, enabled: true });
    const el = await PublicBookingSegmentLayout({
      params: Promise.resolve({ publicId: "p1" }), children: SENTINEL,
    });
    expect(el).toBe(SENTINEL);
  });

  it("catches its own read failure: renders children bare rather than throwing", async () => {
    getCalendarByPublicIdMock.mockRejectedValue(new Error("db down"));
    const el = await PublicBookingSegmentLayout({
      params: Promise.resolve({ publicId: "p1" }), children: SENTINEL,
    });
    expect(el).toBe(SENTINEL);
  });
});

describe("generateMetadata (fallback tab title for /b/[publicId])", () => {
  it("catches its own read failure and falls back to the brand-free English title", async () => {
    getCalendarByPublicIdMock.mockRejectedValue(new Error("db down"));
    const meta = await generateMetadata({ params: Promise.resolve({ publicId: "p1" }) });
    expect(meta.title).toBe("Book an appointment");
    expect(meta.icons).toEqual({ icon: "/favicon.ico" });
  });
});

// F-102 review round, fix 4 — see `app/f/[publicId]/layout.test.ts`'s
// identical test.
describe("brand/theme chrome (fix 4)", () => {
  it("wraps the branded not-found page in the account's own theme (brand colour), not just logo/name", async () => {
    getCalendarByPublicIdMock.mockResolvedValue(CALENDAR);
    getBrandingMock.mockResolvedValue({
      brandName: "Acme Plumbing", brandLogoPath: null,
      brandColor: "#2563eb", brandNeutral: "cool", brandCorners: "round",
      brandType: "inter", brandMode: "light",
    });
    const el = await PublicBookingSegmentLayout({
      params: Promise.resolve({ publicId: "p1" }), children: SENTINEL,
    }) as { props: { "data-tenant-theme": string; style: Record<string, string> } };
    // MUTATION: compute the theme from UNBRANDED instead of `branding` --
    // this FAILS, since `--accent` would be absent from the wrapper's style.
    expect(el.props["data-tenant-theme"]).toBe("");
    expect(el.props.style).toHaveProperty("--background");
    expect(el.props.style).toHaveProperty("--accent");
  });
});
