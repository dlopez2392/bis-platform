import type { MeetingProvider } from "./provider";

/**
 * Daily.co-backed MeetingProvider. See provider.ts for why this is behind an
 * abstraction and how it is selected.
 */
export function createDailyProvider(apiKey: string): MeetingProvider {
  return {
    async createMeetingRoom({ endsAt }) {
      const res = await fetch("https://api.daily.co/v1/rooms", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          // Deliberately NOT derived from bookingId (e.g. `bis-${bookingId}`)
          // — a room name is the only thing standing between "have the link"
          // and "in the call", and bookingId is neither secret nor even hard
          // to guess (sequential/short ids, or visible in a client's own
          // dashboard). crypto.randomUUID() makes the name unguessable, and
          // a fresh one per call means the room can never be re-derived from
          // booking data alone, even by this same provider.
          name: `bis-${crypto.randomUUID()}`,
          // +1h past the meeting's end: enough slack for a call that runs
          // long, short enough that a stale room does not linger in the
          // Daily dashboard indefinitely.
          properties: { exp: Math.floor(endsAt.getTime() / 1000) + 3600 },
        }),
        // A hung connection must not stall booking creation forever — same
        // rationale and same 10s budget as summary-service's OpenAI call.
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        throw new Error(`daily rooms failed: ${res.status} ${await res.text().catch(() => "")}`);
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error("daily rooms: no url in response");
      return { url: data.url };
    },
  };
}
