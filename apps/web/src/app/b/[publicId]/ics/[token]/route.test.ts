import { describe, it, expect, vi, beforeEach } from "vitest";

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }));
vi.mock("./data", () => ({ loadCalendarFileInput: loadMock }));

import { GET } from "./route";

const TOKEN = "abcdefghijkmnpqrstuvwxyz";
const INPUT = {
  booking: {
    id: "b-1", status: "booked", cancel_token: TOKEN,
    starts_at: "2026-11-01T14:00:00Z", ends_at: "2026-11-01T15:00:00Z", meeting_url: null,
  },
  chain: { rootId: "b-1", depth: 0 },
  publicId: "pub1", brandName: "Rio Roofing", accountZone: "America/Chicago",
};

const call = (token: string, query = "") =>
  GET(new Request(`https://app.bis-rgv.com/b/pub1/ics/${token}${query}`, { headers: { host: "app.bis-rgv.com" } }),
    { params: Promise.resolve({ publicId: "pub1", token }) });

beforeEach(() => {
  loadMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /b/[publicId]/ics/[token] — the add-to-calendar download (F-048)", () => {
  it("answers a live booking with a text/calendar attachment nobody caches or indexes", async () => {
    loadMock.mockResolvedValue(INPUT);
    const res = await call(TOKEN);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="appointment.ics"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const body = await res.text();
    expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(body).toContain("SUMMARY:Appointment with Rio Roofing");
  });

  it("reads the row by the TOKEN, in the booker's language from ?locale=, with a real origin", async () => {
    loadMock.mockResolvedValue(INPUT);
    await call(TOKEN, "?locale=es");
    expect(loadMock).toHaveBeenCalledWith(TOKEN);
    const res = await call(TOKEN, "?locale=es");
    expect(await res.text()).toContain("SUMMARY:Cita con Rio Roofing");
  });

  it("an unknown token, or a booking that is no longer live, is a 404 with no file (mutation: serve a cancelled row → FAILS)", async () => {
    loadMock.mockResolvedValue(null);
    expect((await call(TOKEN)).status).toBe(404);
    loadMock.mockResolvedValue({ ...INPUT, booking: { ...INPUT.booking, status: "cancelled" } });
    const res = await call(TOKEN);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("VCALENDAR");
  });

  it("a token that cannot be one of ours is a 404 before any read (mutation: drop the shape check → the loader is called, FAILS)", async () => {
    for (const bad of ["short", "x".repeat(200), "abcdefghijkmnpqrstuvwxy!", "ABCDEFGHIJKMNPQRSTUVWXYZ"]) {
      expect((await call(encodeURIComponent(bad))).status).toBe(404);
    }
    expect(loadMock).not.toHaveBeenCalled();
  });

  it("a read failure is a 500 that never logs the token (the token is the capability)", async () => {
    loadMock.mockRejectedValue(new Error("db down"));
    const res = await call(TOKEN);
    expect(res.status).toBe(500);
    const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join(" ");
    expect(logged).toContain("db down");
    expect(logged).not.toContain(TOKEN);
  });
});
