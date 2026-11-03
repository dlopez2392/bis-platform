import type { NewAiAct } from "@bis/db/ai-act-rules";
import type { RowAuthor } from "@bis/db";
import type { ActSource } from "@/lib/ai-acts/record";

/** Who every contact write Sofía makes is by (F-115): the AI, with no person behind it. */
export const SOFIA_AUTHOR: RowAuthor = { authorKind: "ai", authorId: null };

/** The act a write is about to log: its id, and the `via` the write sends on its author header. */
export type PlannedAct = { id: string; via: string };

/**
 * F-115 (plan Task 2 Step 7): the id of the act a contact write will log, minted BEFORE the write, so the write
 * can name it (`via: ai_act:<id>`, which 0111 stores on each change row) and the act is inserted under that same
 * id. Null when no act can be recorded for this source, the same test `recordActs` applies (a voice act needs its
 * call row, which `startCallRow` may have failed to make): a write must never name a row that cannot exist.
 */
export function planAct(source: ActSource): PlannedAct | null {
  const recordable = source.actor === "voice" ? source.callId : source.chatId;
  if (!recordable) return null;
  const id = crypto.randomUUID();
  return { id, via: `ai_act:${id}` };
}

/**
 * The acts ONE write produced, the first under the planned id. A fill that writes three columns is one write
 * (one via) and three acts: the change rows name the first, and the others keep ids of their own. No acts (a
 * fill that wrote nothing, a create that found the contact again) means the planned id is never used.
 */
export function underPlannedId(acts: NewAiAct[], plan: PlannedAct | null): NewAiAct[] {
  if (!plan || acts.length === 0) return acts;
  const [first, ...rest] = acts;
  return [{ ...first!, id: plan.id }, ...rest];
}
