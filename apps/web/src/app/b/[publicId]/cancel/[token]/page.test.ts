import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { lookupBookingByTokenMock, getBrandingMock, bookingWasMovedMock } = vi.hoisted(() => ({
  lookupBookingByTokenMock: vi.fn(),
  getBrandingMock: vi.fn(),
  bookingWasMovedMock: vi.fn(),
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
  bookingWasMoved: bookingWasMovedMock,
  brandLogoUrl: () => null,
  brandDisplayName: (b: { brandName: string | null }) => b.brandName?.trim() || "",
}));

import { isValidElement, type ReactElement, type ReactNode } from "react";
import { bookingStrings } from "@/lib/booking/public-strings";
import { renderToStaticMarkup } from "react-dom/server";
// Fix round 3 (m1): the cancel page offers the move only when the MOVE
// page would (`moveState`, real): its context is the move page's own read,
// stubbed here from the same booking row, a calendar switch and a depth.
const moveCtx = vi.hoisted(() => ({ enabled: true, depth: 0 }));
vi.mock("../../move/[token]/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../move/[token]/data")>()),
  loadMoveContextSafe: async () => {
    const row = await lookupBookingByTokenMock();
    return row ? { row, calendar: { id: "cal1", public_id: "pub1", enabled: moveCtx.enabled }, account: {}, depth: moveCtx.depth } : null;
  },
}));
import CancelBookingPage, { generateMetadata } from "./page";
import { CancelForm } from "./cancel-form";

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

/**
 * F-048 (rider): every email that ever went out links THIS page, and the
 * success screen promised "cancel or reschedule". So a live, upcoming booking
 * is offered the move beside the cancel, and an old link whose booking was
 * moved says so instead of "cancelled".
 */
describe("CancelBookingPage — the way to move, and an old link after a move", () => {
  function walk(node: ReactNode, out: { text: string[]; els: ReactElement[] } = { text: [], els: [] }) {
    if (node == null || typeof node === "boolean") return out;
    if (typeof node === "string" || typeof node === "number") { out.text.push(String(node)); return out; }
    if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
    if (isValidElement(node)) { out.els.push(node); walk((node.props as { children?: ReactNode }).children, out); }
    return out;
  }
  const hrefs = (t: ReturnType<typeof walk>) => t.els.map((e) => (e.props as { href?: string }).href).filter(Boolean);
  const render = (locale?: string) => CancelBookingPage({
    params: Promise.resolve({ publicId: "pub1", token: "tok123" }),
    searchParams: Promise.resolve(locale ? { locale } : {}),
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    getBrandingMock.mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
    bookingWasMovedMock.mockReset().mockResolvedValue(false);
  });
  afterEach(() => vi.useRealTimers());

  /** The page's form, rendered: the move link lives in it, so it can go away
   *  once the cancel succeeds. */
  const formOf = (t: ReturnType<typeof walk>) => t.els.find((e) => e.type === CancelForm);

  it("a live, upcoming booking links the move page, in the customer's language (mutation: drop the link → FAILS)", async () => {
    lookupBookingByTokenMock.mockResolvedValue({ ...BOOKING, status: "booked" });
    const form = formOf(walk(await render("es")));
    expect((form?.props as { moveHref?: string }).moveHref).toBe("/b/pub1/move/tok123?locale=es");
    const html = renderToStaticMarkup(form!);
    expect(html).toContain(`<a href="/b/pub1/move/tok123?locale=es">${bookingStrings("es").moveLink}</a>`);
  });

  it("no move is offered on a capped appointment or a switched-off calendar — both would dead-end at contact-us (mutation: canMove from status alone → offered, FAILS)", async () => {
    const { MOVE_CHAIN_MAX } = await import("../../move/[token]/data");
    lookupBookingByTokenMock.mockResolvedValue({ ...BOOKING, status: "booked" });
    try {
      moveCtx.depth = MOVE_CHAIN_MAX;
      expect((formOf(walk(await render()))?.props as { moveHref?: string | null }).moveHref).toBeNull();
      moveCtx.depth = 0;
      moveCtx.enabled = false;
      expect((formOf(walk(await render()))?.props as { moveHref?: string | null }).moveHref).toBeNull();
    } finally {
      moveCtx.depth = 0;
      moveCtx.enabled = true;
    }
  });

  it("no move is offered for a booking that has started, or is over", async () => {
    lookupBookingByTokenMock.mockResolvedValue({ ...BOOKING, status: "booked", starts_at: "2026-09-30T23:00:00Z" });
    const started = formOf(walk(await render()));
    expect((started?.props as { moveHref?: string | null }).moveHref).toBeNull();
    expect(renderToStaticMarkup(started!)).not.toContain("/move/");
    lookupBookingByTokenMock.mockResolvedValue({ ...BOOKING, status: "completed" });
    const over = walk(await render());
    expect(formOf(over)).toBeUndefined();
    expect(hrefs(over).some((h) => h!.includes("/move/"))).toBe(false);
  });

  it("a cancelled booking a move replaced says MOVED; a plain cancel still says cancelled (mutation: ignore bookingWasMoved → FAILS)", async () => {
    lookupBookingByTokenMock.mockResolvedValue({ ...BOOKING, status: "cancelled" });
    bookingWasMovedMock.mockResolvedValueOnce(true);
    // A short title, and the rest as its own line under it (fix round 2, m-d).
    const moved = walk(await render()).text;
    expect(moved).toContain(bookingStrings("en").movedTitle);
    expect(moved).toContain(bookingStrings("en").movedBody);
    expect(walk(await render()).text).toContain(bookingStrings("en").cancelAlreadyCancelledTitle);
    expect(bookingWasMovedMock).toHaveBeenCalledWith(fakeDb, "a1", "bk1");
  });

  it("a failed moved-check falls back to the cancelled words, never an error page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    lookupBookingByTokenMock.mockResolvedValue({ ...BOOKING, status: "cancelled" });
    bookingWasMovedMock.mockRejectedValueOnce(new Error("db down"));
    expect(walk(await render()).text).toContain(bookingStrings("en").cancelAlreadyCancelledTitle);
  });
});

/**
 * Fix round 1 (m3): the token is the capability to cancel AND (F-048) to
 * move this booking, so no log line may carry it — the move page's rule.
 * Both read failures this page logs are forced, with a database message that
 * quotes the token back, the way a filter error can.
 */
describe("CancelBookingPage never logs the token", () => {
  it("a failed booking read and a failed branding read log without it (mutation: log the token → FAILS)", async () => {
    const TOKEN = "abcdefghijkmnpqrstuvwxyz";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      lookupBookingByTokenMock.mockRejectedValue(new Error(`no row for cancel_token=${TOKEN}`));
      await generateMetadata({ params: Promise.resolve({ publicId: "pub1", token: TOKEN }), searchParams: noSearchParams });
      lookupBookingByTokenMock.mockResolvedValue({ ...BOOKING, cancel_token: TOKEN });
      getBrandingMock.mockRejectedValue(new Error("branding down"));
      await CancelBookingPage({ params: Promise.resolve({ publicId: "pub1", token: TOKEN }), searchParams: noSearchParams });
      const logged = errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(logged).toMatch(/booking read failed/);
      expect(logged).toMatch(/branding read failed/);
      expect(logged).not.toContain(TOKEN);
    } finally { errors.mockRestore(); }
  });
});
