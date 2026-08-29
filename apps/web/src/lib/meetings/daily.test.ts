import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDailyProvider } from "./daily";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ url: "https://bis.daily.co/bis-abc123" }),
    text: async () => "",
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("createDailyProvider", () => {
  it("POSTs to the Daily rooms endpoint with a Bearer key", async () => {
    const provider = createDailyProvider("dk_test");
    await provider.createMeetingRoom({ bookingId: "b1", endsAt: new Date("2026-09-01T12:00:00Z") });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.daily.co/v1/rooms",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer dk_test",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("sets properties.exp to roughly one hour past endsAt", async () => {
    const provider = createDailyProvider("dk_test");
    const endsAt = new Date("2026-09-01T12:00:00Z");
    await provider.createMeetingRoom({ bookingId: "b1", endsAt });

    const init = fetchMock.mock.calls[0]![1]!;
    const body = JSON.parse(init.body as string);
    const expected = Math.floor(endsAt.getTime() / 1000) + 3600;
    expect(body.properties.exp).toBeGreaterThanOrEqual(expected - 5);
    expect(body.properties.exp).toBeLessThanOrEqual(expected + 5);
  });

  // Guessable room names would let anyone who knows (or brute-forces) a
  // bookingId drop into a client's video call uninvited. Pinning "not derived
  // from bookingId" AND "different across two calls for the same booking"
  // rules out both a deterministic hash and a fixed per-booking name.
  it("names the room unguessably — not derived from bookingId, and different across repeat calls", async () => {
    const provider = createDailyProvider("dk_test");
    const endsAt = new Date("2026-09-01T12:00:00Z");

    await provider.createMeetingRoom({ bookingId: "same-booking-id", endsAt });
    const name1 = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).name as string;

    await provider.createMeetingRoom({ bookingId: "same-booking-id", endsAt });
    const name2 = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string).name as string;

    expect(name1).not.toContain("same-booking-id");
    expect(name2).not.toContain("same-booking-id");
    expect(name1).not.toBe(name2);
  });

  it("throws with the status in the message on a non-ok response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 402, text: async () => "payment required" });
    const provider = createDailyProvider("dk_test");

    await expect(
      provider.createMeetingRoom({ bookingId: "b1", endsAt: new Date("2026-09-01T12:00:00Z") }),
    ).rejects.toThrow(/402/);
  });

  it("throws when Daily returns ok with no url", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const provider = createDailyProvider("dk_test");

    await expect(
      provider.createMeetingRoom({ bookingId: "b1", endsAt: new Date("2026-09-01T12:00:00Z") }),
    ).rejects.toThrow(/no url/);
  });

  // A hung connection must not stall the caller (booking creation) forever —
  // same rationale as summary-service's OpenAI call.
  it("carries an AbortSignal", async () => {
    const provider = createDailyProvider("dk_test");
    await provider.createMeetingRoom({ bookingId: "b1", endsAt: new Date("2026-09-01T12:00:00Z") });

    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("resolves with the room url Daily returned", async () => {
    const provider = createDailyProvider("dk_test");
    const result = await provider.createMeetingRoom({ bookingId: "b1", endsAt: new Date("2026-09-01T12:00:00Z") });

    expect(result).toEqual({ url: "https://bis.daily.co/bis-abc123" });
  });
});
