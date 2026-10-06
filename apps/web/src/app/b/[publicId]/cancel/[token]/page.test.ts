import { describe, it, expect, vi, beforeEach } from "vitest";

const { lookupBookingByTokenMock, getBrandingMock } = vi.hoisted(() => ({
  lookupBookingByTokenMock: vi.fn(),
  getBrandingMock: vi.fn(),
}));
vi.mock("./actions", () => ({ lookupBookingByToken: lookupBookingByTokenMock }));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getBranding: getBrandingMock,
  brandLogoUrl: () => null,
  brandDisplayName: (b: { brandName: string | null }) => b.brandName?.trim() || "",
}));

import { generateMetadata } from "./page";

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
});
