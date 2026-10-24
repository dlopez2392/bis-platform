import { describe, it, expect, vi, beforeEach } from "vitest";

// Same `vi.hoisted` shape `c/[publicId]/page.test.ts` uses, and for the same
// reason: `vi.mock` factories are hoisted above these `const`s.
//
// S-47d (task 13): `../data`'s `loadClosureView` (called by this page after
// the timezone read) reaches three MORE `@bis/db` exports at import time, so
// this bare factory needs all three or the real module loads behind the
// mock and throws for want of Supabase credentials.
const {
  getCalendarByPublicIdMock, getBrandingMock,
  getBusinessStatusRowMock, listClosedDaysFromMock, readHoursChainMock,
} = vi.hoisted(() => ({
  getCalendarByPublicIdMock: vi.fn(),
  getBrandingMock: vi.fn(),
  getBusinessStatusRowMock: vi.fn(),
  listClosedDaysFromMock: vi.fn(),
  readHoursChainMock: vi.fn(),
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
  getBusinessStatusRow: getBusinessStatusRowMock,
  listClosedDaysFrom: listClosedDaysFromMock,
  readHoursChain: readHoursChainMock,
}));

import PublicBookingPage, { generateMetadata } from "./page";
import { BookingPage } from "../booking-page";
import { bookingStrings } from "@/lib/booking/public-strings";

const CALENDAR = { id: "cal1", account_id: "a1", enabled: true, max_advance_days: 30 };
const noSearchParams = Promise.resolve({});

beforeEach(() => {
  getCalendarByPublicIdMock.mockReset();
  getBrandingMock.mockReset();
  getBusinessStatusRowMock.mockReset();
  listClosedDaysFromMock.mockReset();
  readHoursChainMock.mockReset();
  // The default closure read: no row, no closed days, no hours -- "open",
  // so every test that does not care about closures keeps seeing none.
  getBusinessStatusRowMock.mockResolvedValue(null);
  listClosedDaysFromMock.mockResolvedValue([]);
  readHoursChainMock.mockResolvedValue({ businessHours: null, calendarHours: null });
});

/** Finds the `<BookingPage>` element in the page's returned tree without
 *  RENDERING it (this file calls the page component directly, never through
 *  a DOM renderer, so `<BookingPage {...props}/>` is still just a plain
 *  React element object here -- `el.props.lang`'s own test above relies on
 *  the identical fact). */
function bookingPageElement(el: { props: { children: unknown } }): { props: Record<string, unknown> } {
  const children = Array.isArray(el.props.children) ? el.props.children : [el.props.children];
  const found = children.find((c): c is { type: unknown; props: Record<string, unknown> } =>
    !!c && typeof c === "object" && "type" in c && c.type === BookingPage);
  if (!found) throw new Error("no <BookingPage> element in the page's returned tree");
  return found;
}

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

/**
 * S-47d (task 13, spec section 5.3): the page wires `loadClosureView`'s
 * answer onto `<BookingPage>`'s own `closureNotice`/`closedDayKeys` props.
 * Each scenario below is picked to need no particular "today" (storm in
 * force short-circuits `effectiveStatus`'s precedence before any date-of-
 * today lookup, per `status.ts`'s `active()`), so these stay deterministic
 * whatever day they run on — the date-dependent scenarios (closed_today, a
 * planned closed day, the exact pinned storm-until sentence) are covered at
 * `../data.test.ts`'s own level, where `now` is a typed-out literal.
 */
describe("PublicBookingPage wires the closure notice onto BookingPage (S-47d task 13)", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-key");
    getCalendarByPublicIdMock.mockResolvedValue(CALENDAR);
    getBrandingMock.mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
  });

  it("an open-ended storm: the literal stormNotice reaches BookingPage's props", async () => {
    getBusinessStatusRowMock.mockResolvedValue({
      account_id: "a1", state: "storm", late_minutes: null, until: null,
      set_by: "owner", set_at: "2020-01-01T00:00:00.000Z",
    });
    const el = await PublicBookingPage({
      params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams,
    });
    const booking = bookingPageElement(el);
    // MUTATION: never call loadClosureView / always pass `closureNotice: null`
    // -- this FAILS.
    expect(booking.props.closureNotice).toBe(bookingStrings("en").stormNotice);
  });

  it("a failed closure read renders the page with no notice, never throws", async () => {
    getBusinessStatusRowMock.mockRejectedValue(new Error("read failed"));
    const el = await PublicBookingPage({
      params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams,
    });
    const booking = bookingPageElement(el);
    expect(booking.props.closureNotice).toBeNull();
    expect(booking.props.closedDayKeys).toEqual([]);
  });

  it("passes closedDayKeys through to BookingPage", async () => {
    listClosedDaysFromMock.mockResolvedValue([
      { id: "cd1", account_id: "a1", starts_on: "2020-01-01", ends_on: "2099-01-01", reason: "other", created_by: "o", created_at: "x" },
    ]);
    const el = await PublicBookingPage({
      params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams,
    });
    const booking = bookingPageElement(el);
    // MUTATION: pass `closedDayKeys: []` unconditionally -- this FAILS, since
    // a range spanning 2020-2099 covers every day the test could run on.
    expect((booking.props.closedDayKeys as string[]).length).toBeGreaterThan(0);
  });
});
