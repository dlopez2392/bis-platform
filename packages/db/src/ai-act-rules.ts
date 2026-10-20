import type { ContactFieldName } from "./proposal-rules";

/**
 * The pure model of one act Sofia (the phone receptionist) or the web chat took live, with no person
 * approving it (item 8c, spec "The act data"; migration 0091's `ai_acts`). Pure: no client, no I/O,
 * imports only `./proposal-rules`'s type, safe in the browser. Web code imports these from
 * `@bis/db/ai-act-rules`, never from the barrel, so no bare `vi.mock("@bis/db", () => ({ ... }))`
 * factory can blank them.
 */

export const AI_ACT_KINDS = ["booking_created", "booking_rescheduled", "booking_cancelled", "contact_created", "contact_field_filled"] as const;
export type AiActKind = (typeof AI_ACT_KINDS)[number];
export type AiActActor = "voice" | "webchat";

type Slot = { startsAt: string; endsAt: string };

/** `kind` tied to its matching `target`/`before`/`after`, so a mismatch cannot typecheck at
 *  `insertAiActs`'s call site. These are jsonb columns with no CHECK of their own, so on the way IN
 *  this type is the guard; on the way OUT `parseAiAct` is. */
export type AiActData =
  | { kind: "booking_created"; target: { bookingId: string }; before: null; after: Slot }
  | { kind: "booking_rescheduled"; target: { bookingId: string; fromBookingId: string }; before: Slot & { version: string }; after: Slot }
  | { kind: "booking_cancelled"; target: { bookingId: string }; before: Slot; after: { version: string } }
  | { kind: "contact_created"; target: { messageId?: string; submissionId?: string }; before: null; after: null }
  | { kind: "contact_field_filled"; target: { field: ContactFieldName }; before: { value: string | null }; after: { value: string } };

export type NewAiAct = AiActData & { actor: AiActActor; callId: string | null; chatId: string | null; contactId: string };
export type AiAct = NewAiAct & {
  id: string; accountId: string; createdAt: string; undoneAt: string | null; undoneBy: string | null; undoNotified: boolean;
};

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const CONTACT_FIELD_NAMES: readonly string[] = ["firstName", "lastName", "email", "phone"] satisfies ContactFieldName[];
const isSlot = (v: unknown): v is Slot => isObject(v) && isStr(v.startsAt) && isStr(v.endsAt);

/** The read boundary: null when `target`/`before`/`after` do not fit `kind`'s own shape. */
function parseData(kind: string, target: unknown, before: unknown, after: unknown): AiActData | null {
  if (!isObject(target)) return null;
  switch (kind) {
    case "booking_created": {
      if (!isStr(target.bookingId) || before !== null || !isSlot(after)) return null;
      return { kind, target: { bookingId: target.bookingId }, before: null, after };
    }
    case "booking_rescheduled": {
      if (!isStr(target.bookingId) || !isStr(target.fromBookingId)) return null;
      if (!isObject(before) || !isStr(before.startsAt) || !isStr(before.endsAt) || !isStr(before.version)) return null;
      if (!isSlot(after)) return null;
      return {
        kind, target: { bookingId: target.bookingId, fromBookingId: target.fromBookingId },
        before: { startsAt: before.startsAt, endsAt: before.endsAt, version: before.version }, after,
      };
    }
    case "booking_cancelled": {
      if (!isStr(target.bookingId)) return null;
      if (!isSlot(before)) return null;
      if (!isObject(after) || !isStr(after.version)) return null;
      return { kind, target: { bookingId: target.bookingId }, before, after: { version: after.version } };
    }
    case "contact_created": {
      if (target.messageId !== undefined && !isStr(target.messageId)) return null;
      if (target.submissionId !== undefined && !isStr(target.submissionId)) return null;
      if (before !== null || after !== null) return null;
      const t: { messageId?: string; submissionId?: string } = {};
      if (isStr(target.messageId)) t.messageId = target.messageId;
      if (isStr(target.submissionId)) t.submissionId = target.submissionId;
      return { kind, target: t, before: null, after: null };
    }
    case "contact_field_filled": {
      if (!isStr(target.field) || !CONTACT_FIELD_NAMES.includes(target.field)) return null;
      if (!isObject(before) || !strOrNull(before.value)) return null;
      if (!isObject(after) || !isStr(after.value)) return null;
      return {
        kind, target: { field: target.field as ContactFieldName },
        before: { value: before.value }, after: { value: after.value },
      };
    }
    default:
      return null;
  }
}

/**
 * Reads one raw `ai_acts` row (snake_case, exactly as PostgREST returns it) into the typed `AiAct`, or
 * null when any part does not fit — a row whose payload cannot be trusted is skipped and logged by id
 * (`ai-acts.ts`), never thrown, so one bad row never takes a timeline page down.
 */
export function parseAiAct(row: unknown): AiAct | null {
  if (!isObject(row)) return null;
  const { id, account_id, contact_id, actor, call_id, chat_id, kind, target, before, after,
    undone_at, undone_by, undo_notified, created_at } = row;
  if (!isStr(id) || !isStr(account_id) || !isStr(contact_id) || !isStr(created_at)) return null;
  if (actor !== "voice" && actor !== "webchat") return null;
  if (!strOrNull(call_id) || !strOrNull(chat_id)) return null;
  if ((actor === "voice") !== (call_id !== null) || (actor === "webchat") !== (chat_id !== null)) return null;
  if (!strOrNull(undone_at) || !strOrNull(undone_by)) return null;
  if ((undone_at === null) !== (undone_by === null)) return null;
  if (typeof undo_notified !== "boolean") return null;
  if (typeof kind !== "string" || !(AI_ACT_KINDS as readonly string[]).includes(kind)) return null;
  const data = parseData(kind, target, before, after);
  if (!data) return null;
  return {
    ...data, id, accountId: account_id, contactId: contact_id, actor, callId: call_id, chatId: chat_id,
    createdAt: created_at, undoneAt: undone_at, undoneBy: undone_by, undoNotified: undo_notified,
  };
}
