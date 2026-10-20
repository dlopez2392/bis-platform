import { insertAiActs, type serviceDb } from "@bis/db";
import type { NewAiAct } from "@bis/db/ai-act-rules";
import type { ContactFieldName } from "@bis/db/proposal-rules";

/**
 * Records what Sofía (the phone) or the web chat just did on her own, beside the write itself
 * (item 8c, spec §4.3). Bookkeeping, never the work: the booking, the contact and the fill are
 * already committed when this runs, and nothing here may change what the caller hears or what the
 * call goes on to do.
 *
 * - NEVER throws and never rethrows. A database error is logged and the act is simply not recorded.
 * - BOUNDED: the insert races `ACT_RECORD_TIMEOUT_MS`. A live call waits at most that long per tool
 *   call for this, never on a hung database. On a timeout the insert is left to land (or fail) on its
 *   own and is never awaited again; a late failure is still caught and logged.
 * - ONE insert per call: a site that produced several acts (a contact plus its fills, a contact plus
 *   its booking) hands them all over at once.
 * - An act with no source is skipped (ambiguity E): a voice act needs its call row (`startCallRow`
 *   fails open, so it can be null) and a chat act its conversation; 0091's source CHECK would refuse
 *   either. The booking or contact still carries its AI author.
 * - Logs ids and an error code or name ONLY. Never a name, an email, a phone, a field value, a time a
 *   customer chose, or a database message (Postgres messages quote the offending value).
 */
export const ACT_RECORD_TIMEOUT_MS = 1000;

type Db = ReturnType<typeof serviceDb>;

function source(a: NewAiAct): string | null {
  if (a.actor === "voice") return a.callId ? `call:${a.callId}` : null;
  return a.chatId ? `chat:${a.chatId}` : null;
}

function errorCode(e: unknown): string {
  if (e && typeof e === "object") {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
    const name = (e as { name?: unknown }).name;
    if (typeof name === "string" && name) return name;
  }
  return "unknown";
}

export async function recordActs(db: Db, accountId: string, acts: readonly NewAiAct[]): Promise<void> {
  try {
    const sourced: NewAiAct[] = [];
    for (const a of acts) {
      if (source(a)) sourced.push(a);
      else console.warn(`ai act not recorded: no source kind=${a.kind} account=${accountId} contact=${a.contactId}`);
    }
    if (sourced.length === 0) return;

    // Never rejects: a failure, early or late, becomes its own log line here.
    const insert = Promise.resolve()
      .then(() => insertAiActs(db, accountId, sourced))
      .then(() => "ok" as const, (e: unknown) => {
        for (const a of sourced) {
          console.error(`ai act not recorded: kind=${a.kind} account=${accountId} source=${source(a)} contact=${a.contactId}: ${errorCode(e)}`);
        }
        return "failed" as const;
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), ACT_RECORD_TIMEOUT_MS);
    });
    const outcome = await Promise.race([insert, timeout]);
    clearTimeout(timer);
    if (outcome === "timeout") {
      for (const a of sourced) {
        console.error(`ai act not recorded: timed out after ${ACT_RECORD_TIMEOUT_MS} ms kind=${a.kind} account=${accountId} source=${source(a)}`);
      }
    }
  } catch (e) {
    // The net under the net: nothing above should throw, and nothing here may.
    console.error(`ai act not recorded: account=${accountId}: ${errorCode(e)}`);
  }
}

export function recordAct(db: Db, accountId: string, act: NewAiAct): Promise<void> {
  return recordActs(db, accountId, [act]);
}

/** Who took an act, and on which call or chat: the part every act of one site shares. */
export type ActSource = Pick<NewAiAct, "actor" | "callId" | "chatId">;

export function voiceSource(callId: string | null): ActSource {
  return { actor: "voice", callId, chatId: null };
}

/**
 * One `contact_field_filled` per column `fillContactBlanksReport` actually wrote: `before` is the
 * column as it read before the write, `after` the STORED form (the phone's E.164, never the raw
 * input). A fill that wrote nothing makes no act.
 */
export function fieldFillActs(
  source: ActSource, contactId: string,
  report: { prior: Partial<Record<ContactFieldName, string | null>>; written: Partial<Record<ContactFieldName, string>> },
): NewAiAct[] {
  const acts: NewAiAct[] = [];
  for (const field of Object.keys(report.written) as ContactFieldName[]) {
    const after = report.written[field];
    if (typeof after !== "string") continue;
    acts.push({
      ...source, kind: "contact_field_filled", contactId,
      target: { field }, before: { value: report.prior[field] ?? null }, after: { value: after },
    });
  }
  return acts;
}
