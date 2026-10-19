import { addTask, deleteTaskForUndo, readPersonId, taskAssigneeFor } from "@bis/db";
import { parseTaskPayload, type TaskPayload } from "@bis/db/proposal-rules";
import { formatDateInZone } from "@/lib/format";
import { addLocalDays, firstInstantOfLocalDay, localDateKey } from "../local-day";
import type { KindDef, Part } from "./types";

/** generate.ts's MAX_TITLE_LEN: the generator clamps, an edit is told. */
const MAX_TITLE_LEN = 200;
/** generate.ts's MAX_DUE_AT_FORWARD_MS, in local days: today through today + 365. */
const MAX_DUE_DAYS = 365;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
/** Stands in for the title inside the translated sentence, so the sentence can be split around it. No
 *  vowels: the pseudo-locale rewrites vowels and would break it. */
const SLOT = "␟";

/** "Add a to-do: {title}" as parts: the reader's words, and the model's English title as its own part. */
function sentenceAround(sentence: string, value: string): Part[] {
  const [before = "", after = ""] = sentence.split(SLOT);
  const parts: Part[] = [];
  if (before) parts.push({ text: before });
  parts.push({ text: value, lang: "en" });
  if (after) parts.push({ text: after });
  return parts;
}

function isPastDue(dueAt: string | null, zone: string, now: Date): boolean {
  return dueAt !== null && localDateKey(new Date(dueAt), zone) < localDateKey(now, zone);
}

type RefT = { taskId: string; title: string; dueAt: string | null };
function readRef(ref: unknown): RefT | null {
  if (ref === null || typeof ref !== "object") return null;
  const r = ref as Record<string, unknown>;
  if (typeof r.taskId !== "string" || typeof r.title !== "string") return null;
  if (r.dueAt !== null && typeof r.dueAt !== "string") return null;
  return { taskId: r.taskId, title: r.title, dueAt: r.dueAt };
}

export const taskKind: KindDef<"task", TaskPayload> = {
  kind: "task",
  sources: ["call"],
  needsContact: false,
  dataClass: "facts",
  parse: parseTaskPayload,

  describe(p, { tr, zone, now }) {
    const pastDue = isPastDue(p.dueAt, zone, now);
    const detail = p.dueAt === null ? null
      : tr.text(pastDue ? "suggestions.wasDue" : "suggestions.due", { date: formatDateInZone(p.dueAt, zone, tr.locale) });
    return { parts: sentenceAround(tr.text("suggestions.task", { title: SLOT }), p.title), detail, pastDue };
  },

  editable: ["title", "dueAt"],

  // The stored payload is not read: both of a to-do's fields are editable, so the result is built from
  // those two alone, never from `input` as a whole.
  validateEdit(_stored, input, { zone, now }) {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title) return { ok: false, error: { field: "title", key: "suggestions.edit.titleRequired" } };
    if (title.length > MAX_TITLE_LEN) return { ok: false, error: { field: "title", key: "suggestions.edit.titleTooLong" } };

    const raw = input.dueAt ?? "";
    let dueAt: string | null = null;
    if (typeof raw !== "string") return { ok: false, error: { field: "dueAt", key: "suggestions.edit.dueInvalid" } };
    const key = raw.trim();
    if (key) {
      const today = localDateKey(now, zone);
      // addLocalDays(key, 0) round-trips only a real calendar day ("2026-02-30" comes back as March 2nd).
      const real = DATE_KEY.test(key) && addLocalDays(key, 0) === key;
      if (!real || key < today || key > addLocalDays(today, MAX_DUE_DAYS)) {
        return { ok: false, error: { field: "dueAt", key: "suggestions.edit.dueInvalid" } };
      }
      dueAt = firstInstantOfLocalDay(key, zone);
    }
    return { ok: true, payload: { title, dueAt } };
  },

  normalise(p) {
    return { title: p.title.trim(), dueAt: p.dueAt === null ? null : new Date(p.dueAt).toISOString() };
  },

  async stillHolds() {
    return { ok: true };
  },

  async apply({ db, accountId, userId, contactId }, p) {
    // F-085 part 1: whoever holds the customer, else whoever accepted it (the old action's rule).
    const assignedTo = await taskAssigneeFor(db, accountId, contactId, await readPersonId(db, accountId, userId));
    const { id } = await addTask(db, accountId, {
      contactId: contactId ?? undefined, title: p.title, dueAt: p.dueAt ?? undefined, assignedTo,
    }, userId);
    return { ref: { taskId: id, title: p.title, dueAt: p.dueAt } };
  },

  inverse: {
    async undo({ db, accountId, userId }, ref) {
      const r = readRef(ref);
      if (!r) return "changed";
      const deleted = await deleteTaskForUndo(db, accountId, r.taskId, userId, { title: r.title, dueAt: r.dueAt });
      return deleted ? "undone" : "changed";
    },
  },

  toast: (_p, tr) => tr.text("suggestions.toast.task"),
  targetKey: () => null,
};
