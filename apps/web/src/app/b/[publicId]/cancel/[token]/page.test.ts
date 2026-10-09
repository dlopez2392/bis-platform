import { describe, it, expect, vi, beforeEach } from "vitest";

const { lookupBookingByTokenMock, getBrandingMock } = vi.hoisted(() => ({
  lookupBookingByTokenMock: vi.fn(),
  getBrandingMock: vi.fn(),
}));
// One fake `serviceDb()` answering both chained reads this route makes:
// `page.tsx`'s own `loadTimezone` (accounts) and `./data.ts`'s REAL
// `lookupBookingByToken` (bookings), whose row comes from
// `lookupBookingByTokenMock`. A rejection becomes the query error the real
// lookup turns into a throw, so `loadBookingSafe`'s catch is the real one.
const fakeDb = {
  from: (table: string) => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => {
      if (table !== "bookings") return { data: { timezone: "America/Chicago" }, error: null };
      try {
        return { data: await lookupBookingByTokenMock(), error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
  }) }) }),
};
vi.mock("@bis/db", () => ({
  serviceDb: () => fakeDb,
  getBranding: getBrandingMock,
  brandLogoUrl: () => null,
  brandDisplayName: (b: { brandName: string | null }) => b.brandName?.trim() || "",
}));

import CancelBookingPage, { generateMetadata } from "./page";

const BOOKING = { id: "bk1", account_id: "a1", calendar_id: "cal1", contact_id: "c1",
  starts_at: "2026-10-10T15:00:00Z", ends_at: "2026-10-10T16:00:00Z", status: "confirmed",
  note: null, cancel_token: "tok123", booker_timezone: null, reminder_sent_at: null };

const noSearchParams = Promise.resolve({});

beforeEach(() => {
  lookupBookingByTokenMock.mockReset();
  getBrandingMock.mockReset();
});

describe("/b/[publicId]/cancel/[token] metadata (F-102 — the title was always the generic word 'Booking')", () => {
  it("is noindex for an unknown token", async () => {
    lookupBookingByTokenMock.mockResolvedValue(null);
    const meta = await generateMetadata({
      params: Promise.resolve({ publicId: "pub1", token: "tok123" }), searchParams: noSearchParams,
    });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.title).toBeUndefined();
  });

  it("uses the CANCEL wording, not the booking page's own title", async () => {
    lookupBookingByTokenMock.mockResolvedValue(BOOKING);
    getBrandingMock.mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
    const meta = await generateMetadata({
      params: Promise.resolve({ publicId: "pub1", token: "tok123" }), searchParams: noSearchParams,
    });
    expect(meta.title).toBe("Cancel your visit with Acme Plumbing");
  });

  // F-102 defect :881's title-adjacent half: unlike `<html lang>` (which this
  // page's layout cannot resolve from the query at all), the TITLE has
  // searchParams available right here and must honor it.
  it("honors ?locale=es in the title", async () => {
    lookupBookingByTokenMock.mockResolvedValue(BOOKING);
    getBrandingMock.mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
    const meta = await generateMetadata({
      params: Promise.resolve({ publicId: "pub1", token: "tok123" }),
      searchParams: Promise.resolve({ locale: "es" }),
    });
    expect(meta.title).toBe("Cancela tu cita con Acme Plumbing");
  });

  // F-102 review round, fix 1 (widened) — see
  // `app/f/[publicId]/page.test.ts`'s identical test.
  it("never throws, even when the underlying read fails — falls back to {robots}", async () => {
    lookupBookingByTokenMock.mockRejectedValue(new Error("Invalid API key"));
    // MUTATION: call the page's OWN `loadBooking` here instead of
    // `loadBookingSafe` -- this FAILS (the promise rejects).
    await expect(
      generateMetadata({
        params: Promise.resolve({ publicId: "pub1", token: "tok123" }), searchParams: noSearchParams,
      }),
    ).resolves.toEqual({ robots: { index: false, follow: false } });
  });
});

// F-102 review round, second pass (item 2): removing `lang={locale}` from
// this element left every test in this file (9) green — nothing asserted
// it. This is the fix that actually clears defect :881 at the element
// level for the normal case (a real confirmation/reminder email link).
describe("CancelBookingPage <main lang>", () => {
  beforeEach(() => {
    lookupBookingByTokenMock.mockResolvedValue(BOOKING);
    getBrandingMock.mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
  });

  it("defaults to en when ?locale is absent", async () => {
    const el = await CancelBookingPage({
      params: Promise.resolve({ publicId: "pub1", token: "tok123" }), searchParams: noSearchParams,
    });
    // MUTATION: drop `lang={locale}` from <main> in page.tsx -- this FAILS
    // (`el.props.lang` is `undefined`).
    expect(el.props.lang).toBe("en");
  });

  it("carries ?locale=es — the SAME override a confirmation email's link carries", async () => {
    const el = await CancelBookingPage({
      params: Promise.resolve({ publicId: "pub1", token: "tok123" }),
      searchParams: Promise.resolve({ locale: "es" }),
    });
    expect(el.props.lang).toBe("es");
  });
});
