import { describe, it, expect, vi, beforeEach } from "vitest";

// Same `vi.hoisted` shape `c/[publicId]/page.test.ts` uses, and for the same
// reason: `vi.mock` factories are hoisted above these `const`s.
const { getCalendarByPublicIdMock, getBrandingMock } = vi.hoisted(() => ({
  getCalendarByPublicIdMock: vi.fn(),
  getBrandingMock: vi.fn(),
}));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getCalendarByPublicId: getCalendarByPublicIdMock,
  getBranding: getBrandingMock,
  brandLogoUrl: () => null,
  brandDisplayName: (b: { brandName: string | null }) => b.brandName?.trim() || "",
}));

import { generateMetadata } from "./page";

const CALENDAR = { id: "cal1", account_id: "a1", enabled: true, max_advance_days: 30 };
const noSearchParams = Promise.resolve({});

beforeEach(() => {
  getCalendarByPublicIdMock.mockReset();
  getBrandingMock.mockReset();
});

describe("/b/[publicId] metadata (F-102, defect :870 — the tab title was always the English word 'Booking')", () => {
  it("is noindex for a disabled calendar", async () => {
    getCalendarByPublicIdMock.mockResolvedValue({ ...CALENDAR, enabled: false });
    const meta = await generateMetadata({
      params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams,
    });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.title).toBeUndefined();
  });

  it("sets the business name into the English title", async () => {
    getCalendarByPublicIdMock.mockResolvedValue(CALENDAR);
    getBrandingMock.mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
    const meta = await generateMetadata({
      params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams,
    });
    expect(meta.title).toBe("Book with Acme Plumbing");
  });

  // MUTATION: hard-code the locale to "en" in generateMetadata regardless of
  // `?locale=` -- this FAILS, since the title would stay English for a host
  // page that forwarded `data-locale="es"`.
  it("honors ?locale=es, since generateMetadata (unlike a layout) receives searchParams", async () => {
    getCalendarByPublicIdMock.mockResolvedValue(CALENDAR);
    getBrandingMock.mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
    const meta = await generateMetadata({
      params: Promise.resolve({ publicId: "abc123" }),
      searchParams: Promise.resolve({ locale: "es" }),
    });
    expect(meta.title).toBe("Reserva con Acme Plumbing");
  });

  it("falls back to the brand-free English title when the business name is blank", async () => {
    getCalendarByPublicIdMock.mockResolvedValue(CALENDAR);
    getBrandingMock.mockResolvedValue({ brandName: null, brandLogoPath: null });
    const meta = await generateMetadata({
      params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams,
    });
    expect(meta.title).toBe("Book an appointment");
  });
});
