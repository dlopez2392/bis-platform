import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const m = vi.hoisted(() => ({
  loadMoveContext: vi.fn(), loadMoveContextSafe: vi.fn(), getBranding: vi.fn(), bookingWasMoved: vi.fn(),
}));
vi.mock("./data", async (importOriginal) => {
  const real = await importOriginal<typeof import("./data")>();
  return { ...real, loadMoveContext: m.loadMoveContext, loadMoveContextSafe: m.loadMoveContextSafe };
});
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return {
    ...real, serviceDb: () => ({}), getBranding: m.getBranding, bookingWasMoved: m.bookingWasMoved,
    brandLogoUrl: () => null,
  };
});
// The server actions are only bound and handed down here, never called.
vi.mock("./actions", () => ({ getMoveSlotsAction: vi.fn(), confirmMoveAction: vi.fn() }));

import { newCancelToken } from "@bis/db";
import { bookingStrings } from "@/lib/booking/public-strings";
import { formatWhen } from "@/lib/booking/time";
import MoveBookingPage, { generateMetadata } from "./page";
import { MoveForm } from "./move-form";

/**
 * F-048: `/b/<publicId>/move/<token>`. The F-102 shell (`lang`, branded dead
 * ends), the token rules (a malformed one 404s UNREAD), and the four states a
 * link can be in: live (the picker), moved, cancelled, over — plus a
 * switched-off calendar, which stops a move as it stops a new booking.
 */
const TOKEN = newCancelToken();
const NOW = new Date("2027-06-01T00:00:00Z");
const ctx = (row: Record<string, unknown> = {}, cal: Record<string, unknown> = {}) => ({
  row: {
    id: "bk1", account_id: "a1", calendar_id: "cal1", contact_id: "c1", status: "booked",
    starts_at: "2027-06-01T15:00:00.000Z", ends_at: "2027-06-01T16:00:00.000Z",
    booker_timezone: "America/Chicago", ...row,
  },
  calendar: { id: "cal1", account_id: "a1", public_id: "pub1", enabled: true, max_advance_days: 30, ...cal },
  account: { timezone: "America/New_York", brand_name: "Acme Plumbing" },
});
const params = (publicId = "pub1", token = TOKEN) => Promise.resolve({ publicId, token });
const query = (q: Record<string, string> = {}) => Promise.resolve(q);

/** Every string and every element in a rendered tree, children first-class. */
function walk(node: ReactNode, out: { text: string[]; els: ReactElement[] } = { text: [], els: [] }) {
  if (node == null || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") { out.text.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  if (isValidElement(node)) {
    out.els.push(node);
    walk((node.props as { children?: ReactNode }).children, out);
  }
  return out;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  m.loadMoveContext.mockReset().mockResolvedValue(ctx());
  m.loadMoveContextSafe.mockReset().mockResolvedValue(ctx());
  m.getBranding.mockReset().mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
  m.bookingWasMoved.mockReset().mockResolvedValue(false);
});
afterEach(() => vi.useRealTimers());

describe("/b/[publicId]/move/[token]", () => {
  it("a malformed token 404s UNREAD (mutation: drop the token check → the booking is read, FAILS)", async () => {
    await expect(MoveBookingPage({ params: params("pub1", "not-a-token"), searchParams: query() })).rejects.toThrow();
    expect(m.loadMoveContext).not.toHaveBeenCalled();
  });

  it("an unknown token 404s, and so does a link naming another calendar's public id (mutation: skip the id check → FAILS)", async () => {
    m.loadMoveContext.mockResolvedValueOnce(null);
    await expect(MoveBookingPage({ params: params(), searchParams: query() })).rejects.toThrow();
    await expect(MoveBookingPage({ params: params("someoneelse"), searchParams: query() })).rejects.toThrow();
  });

  it("a live booking gets the picker: its current time in the customer's own zone and language, the account's day and horizon, and the cancel page as the other way out", async () => {
    const el = await MoveBookingPage({ params: params(), searchParams: query({ locale: "es" }) });
    expect(el.props.lang).toBe("es");
    const form = walk(el).els.find((e) => e.type === MoveForm);
    expect(form, "the move form renders").toBeDefined();
    const props = form!.props as Record<string, unknown>;
    expect(props.currentWhen).toBe(formatWhen(new Date("2027-06-01T15:00:00.000Z"), "America/Chicago", "es"));
    // Midnight UTC is still May 31 in the account's zone (New York).
    expect(props.todayKey).toBe("2027-05-31");
    expect(props.maxAdvanceDays).toBe(30);
    expect(props.locale).toBe("es");
    expect(props.cancelHref).toBe(`/b/pub1/cancel/${TOKEN}?locale=es`);
  });

  it("an old link after a move says MOVED, not cancelled (mutation: ignore bookingWasMoved → the cancelled words, FAILS)", async () => {
    m.loadMoveContext.mockResolvedValue(ctx({ status: "cancelled" }));
    m.bookingWasMoved.mockResolvedValueOnce(true);
    const moved = walk(await MoveBookingPage({ params: params(), searchParams: query() }));
    expect(moved.text).toContain(bookingStrings("en").movedTitle);
    expect(moved.els.some((e) => e.type === MoveForm)).toBe(false);

    const cancelled = walk(await MoveBookingPage({ params: params(), searchParams: query() }));
    expect(cancelled.text).toContain(bookingStrings("en").cancelAlreadyCancelledTitle);
  });

  it("a booking that is over, or already started, has nothing to move (mutation: judge by status alone → the picker, FAILS)", async () => {
    m.loadMoveContext.mockResolvedValueOnce(ctx({ status: "completed" }));
    expect(walk(await MoveBookingPage({ params: params(), searchParams: query() })).text)
      .toContain(bookingStrings("en").cancelPastTitle);
    m.loadMoveContext.mockResolvedValueOnce(ctx({ starts_at: "2027-05-31T23:30:00.000Z" }));
    const started = walk(await MoveBookingPage({ params: params(), searchParams: query() }));
    expect(started.text).toContain(bookingStrings("en").cancelPastTitle);
    expect(started.els.some((e) => e.type === MoveForm)).toBe(false);
  });

  it("a switched-off calendar says to contact the business, and still offers the cancel", async () => {
    m.loadMoveContext.mockResolvedValueOnce(ctx({}, { enabled: false }));
    const off = walk(await MoveBookingPage({ params: params(), searchParams: query({ locale: "es" }) }));
    expect(off.text).toContain(bookingStrings("es").moveOffline);
    expect(off.els.some((e) => (e.props as { href?: string }).href === `/b/pub1/cancel/${TOKEN}?locale=es`)).toBe(true);
  });
});

describe("/b/[publicId]/move/[token] metadata", () => {
  it("noindex always, the MOVE wording, in the customer's language, and never a throw", async () => {
    const meta = await generateMetadata({ params: params(), searchParams: query({ locale: "es" }) });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.title).toBe("Cambia tu cita con Acme Plumbing");
    m.loadMoveContextSafe.mockResolvedValueOnce(null);
    expect(await generateMetadata({ params: params(), searchParams: query() })).toEqual({ robots: { index: false, follow: false } });
    expect(await generateMetadata({ params: params("pub1", "bad"), searchParams: query() })).toEqual({ robots: { index: false, follow: false } });
  });
});
