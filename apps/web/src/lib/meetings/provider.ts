import { createDailyProvider } from "./daily";

export type MeetingProvider = {
  createMeetingRoom(input: { bookingId: string; endsAt: Date }): Promise<{ url: string }>;
};

/**
 * Chooses the meeting provider for the current environment.
 *
 * Video is entirely optional: no DAILY_API_KEY means no meeting links, not a
 * broken booking flow. Callers get `null` and are expected to treat it as
 * "no video links today" — log it once and carry on, the same shape as a
 * client who never set video up at all. There is no fake provider here (unlike
 * email's fakeEmailProvider) because there is no unsafe side effect to guard
 * against outside production — a dormant integration with no key configured
 * anywhere is already the safe default in every environment, dev included.
 */
export function getMeetingProvider(env: NodeJS.ProcessEnv = process.env): MeetingProvider | null {
  const apiKey = env.DAILY_API_KEY?.trim();
  if (!apiKey) return null;
  return createDailyProvider(apiKey);
}
