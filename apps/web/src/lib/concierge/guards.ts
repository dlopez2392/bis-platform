/**
 * The concierge's own limits, deliberately NOT lib/forms/guards.ts's.
 *
 * Every existing limiter in this repo assumes one POST is one interaction:
 * RATE_LIMIT_MAX 5 per RATE_LIMIT_WINDOW_MS 600s. A real conversation is ten
 * turns in four minutes and would be cut off at turn five; raising that
 * constant to fit a conversation would stop it working as a flood guard for
 * the public form and the booking page, which share it. So these are two
 * limits doing two different jobs, in two files.
 */

/** Turns per conversation, full stop. Generous enough for a real back and
 *  forth, small enough that one visitor cannot bill without bound. */
export const CONCIERGE_MAX_TURNS = 24;

/** How many conversations one visitor may START in the window. Counted on
 *  turn 1 only — turns inside a conversation are governed by the cap above. */
export const CONCIERGE_MAX_CONVERSATIONS_PER_IP = 3;
export const CONCIERGE_IP_WINDOW_MS = 600_000;

/** The per-tenant ceiling, so one client's public page cannot spend alone.
 *  Named rather than inlined, because both windows are tuning knobs and a
 *  bare 86_400_000 hides one of them. */
export const CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY = 300;
export const CONCIERGE_ACCOUNT_WINDOW_MS = 86_400_000;

/** One visitor message. Longer is truncated by the route, never rejected —
 *  a visitor who pasted a long question should get an answer, not an error. */
export const CONCIERGE_MAX_MESSAGE_CHARS = 2_000;
