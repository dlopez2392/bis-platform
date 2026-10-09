import { describe, it, expect, vi, beforeEach } from "vitest";

// Same `vi.hoisted` shape `c/[publicId]/page.test.ts` uses, and for the same
// reason: `vi.mock` factories are hoisted above these `const`s.
const { getCalendarByPublicIdMock, getBrandingMock } = vi.hoisted(() => ({
  getCalendarByPublicIdMock: vi.fn(),
  getBrandingMock: vi.fn(),
}));
// `page.tsx`'s own `loadTimezone` calls `serviceDb().from("accounts")...`
// directly (not through a mocked accessor), unlike `loadCalendarSafe`'s
// `getCalendarByPublicId` — so the component-render tests below need a
// `serviceDb()` that actually answers that one chained call.
const fakeDb = {
  from: () => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: { timezone: "America/Chicago" }, error: null }),
  }) }) }),
};
vi.mock("@bis/db", () => ({
  serviceDb: () => fakeDb,
  getCalendarByPublicId: getCalendarByPublicIdMock,
  getBranding: getBrandingMock,
  brandLogoUrl: () => null,
  brandDisplayName: (b: { brandName: string | null }) => b.brandName?.trim() || "",
}));

import PublicBookingPage, { generateMetadata } from "./page";

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

  // F-102 review round, fix 1 (widened) — see
  // `app/f/[publicId]/page.test.ts`'s identical test.
  it("never throws, even when the underlying read fails — falls back to {robots}", async () => {
    getCalendarByPublicIdMock.mockRejectedValue(new Error("Invalid API key"));
    // MUTATION: call the page's OWN `loadCalendar` here instead of
    // `loadCalendarSafe` -- this FAILS (the promise rejects).
    await expect(
      generateMetadata({ params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams }),
    ).resolves.toEqual({ robots: { index: false, follow: false } });
  });
});

// F-102 review round, second pass (item 2): removing `lang={locale}` from
// this element left every test in this file (9) green — nothing asserted
// it. `<html lang>` (`app/b/layout.tsx`) is always "en" (no per-document
// default to read), so this element is the ONLY place a `?locale=`
// override — the exact signal defect :881's confirmation-email links and
// `embed.js`'s `data-locale` carry — reaches the first server-rendered HTML.
describe("PublicBookingPage <main lang>", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-key");
    getCalendarByPublicIdMock.mockResolvedValue(CALENDAR);
    getBrandingMock.mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
  });

  it("defaults to en when ?locale is absent", async () => {
    const el = await PublicBookingPage({
      params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams,
    });
    // MUTATION: drop `lang={locale}` from <main> in page.tsx -- this FAILS
    // (`el.props.lang` is `undefined`).
    expect(el.props.lang).toBe("en");
  });

  it("carries ?locale=es", async () => {
    const el = await PublicBookingPage({
      params: Promise.resolve({ publicId: "abc123" }),
      searchParams: Promise.resolve({ locale: "es" }),
    });
    expect(el.props.lang).toBe("es");
  });
});
