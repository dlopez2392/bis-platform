import { instantKey } from "./timeline-cursor";

/**
 * S-06 part 3 (spec §2, §3 step 4; G1, G2, G5, G19; plan G27): which turns of a lead's website chat a
 * sync still has to write to the customer's thread, and what each row looks like. PURE: the web
 * reaches it through the SUBPATH `@bis/db/webchat-plan`, so a test that mocks `@bis/db` still runs the
 * real planner. The writer is messaging.ts's fileWebchatTurns; the sync is webchat.ts.
 */
export type WebchatTurn = { role: "visitor" | "assistant"; text: string; at: string };
export type WebchatKey = { index: number; createdAt: string };
export type WebchatRowMeta = {
  chat_id: string; index: number; locale: "en" | "es"; submission_id: string; matched_existing: boolean;
};
export type PlannedWebchatRow = {
  index: number;
  direction: "inbound" | "outbound";
  body: string;
  createdAt: string;
  providerMessageId: string;
  meta: { webchat: WebchatRowMeta };
  /** Plan G27: a VISITOR turn that arrived after the lead was on file (its `at` is later than the
   *  submission's created_at). The writer raises unread for it only when the route also says the lead
   *  was on file when the turn started (spec §4, G7). Sofía's turns never count. */
  countsUnread: boolean;
};

/** The actor id on every chat row's author mapping and on its one event (spec §2). */
export const WEBCHAT_ACTOR_ID = "concierge";
export const WEBCHAT_KEY_PREFIX = "webchat:";
/** G1: the idempotency key, on 0005's project-wide partial unique index. A chat id is a uuid. */
export const webchatKey = (chatId: string, index: number): string => `${WEBCHAT_KEY_PREFIX}${chatId}:${index}`;

/** The index in this chat's own key; null for any other key (another chat's, a provider's, a malformed one). */
export function parseWebchatKey(chatId: string, key: string | null | undefined): number | null {
  const prefix = `${WEBCHAT_KEY_PREFIX}${chatId}:`;
  if (!key || !key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  return /^(0|[1-9][0-9]{0,3})$/.test(rest) ? Number(rest) : null;
}

/** 24 claimed turns at most (CONCIERGE_MAX_TURNS, apps/web lib/concierge/guards.ts:14), each appending
 *  at most one pair (route.ts:653-656). Pinned against the web constant by webchat-plan.test.ts. */
export const WEBCHAT_MAX_ROWS_PER_CHAT = 48;

/**
 * Every transcript index the thread does not hold yet (G2: the array position), in index order, with
 * a created_at that strictly increases in index order given the thread holds a prefix of the transcript (G5: +1 ms on a tie, and never at or before the
 * nearest earlier row, written or planned). An `at` that does not parse takes the previous time + 1 ms,
 * or `now` for the first row.
 */
export function planWebchatRows(input: {
  chatId: string; transcript: readonly WebchatTurn[]; existing: readonly WebchatKey[];
  locale: string; submissionId: string; matchedExisting: boolean; leadAt: string; now: string;
}): PlannedWebchatRow[] {
  const locale: "en" | "es" = input.locale === "es" ? "es" : "en";
  const written = new Map(input.existing.map((k) => [k.index, Date.parse(k.createdAt)]));
  const leadAt = Date.parse(input.leadAt);
  let prev = Number.NEGATIVE_INFINITY;
  const out: PlannedWebchatRow[] = [];
  input.transcript.forEach((turn, index) => {
    const have = written.get(index);
    if (have !== undefined) {
      if (Number.isFinite(have)) prev = Math.max(prev, have);
      return;
    }
    const at = Date.parse(turn.at);
    const base = Number.isFinite(at) ? at : Number.isFinite(prev) ? prev + 1 : Date.parse(input.now);
    const t = Number.isFinite(prev) && base <= prev ? prev + 1 : base;
    prev = t;
    const visitor = turn.role === "visitor";
    out.push({
      index,
      direction: visitor ? "inbound" : "outbound",
      body: turn.text,
      createdAt: new Date(t).toISOString(),
      providerMessageId: webchatKey(input.chatId, index),
      meta: { webchat: { chat_id: input.chatId, index, locale, submission_id: input.submissionId, matched_existing: input.matchedExisting } },
      countsUnread: visitor && Number.isFinite(at) && Number.isFinite(leadAt) && at > leadAt,
    });
  });
  return out;
}

/** Spec §5a (G19): the customer existed before this chat's lead when their row is OLDER than the lead's
 *  submission (written before enrich looks for a contact, lib/concierge/lead.ts:151 then :170). Equal
 *  reads as new. To the microsecond (instantKey); a time that does not parse is not a match. */
export function matchedExistingCustomer(contactCreatedAt: string, submissionCreatedAt: string): boolean {
  try {
    return instantKey(contactCreatedAt) < instantKey(submissionCreatedAt);
  } catch {
    return false;
  }
}
