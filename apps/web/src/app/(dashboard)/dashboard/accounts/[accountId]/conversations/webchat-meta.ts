/**
 * S-06 part 3 (spec §2, §5, §5a): the thread bubble's web chat meta reader. No directive: the thread, a
 * SERVER component, calls it (the inbound-meta.ts lesson, part 1 Task 11b). What the sync wrote
 * (webchat-plan.ts's WebchatRowMeta), read defensively: anything else is not a chat row's meta.
 */
export type WebchatMeta = { chatId: string; index: number; locale: "en" | "es"; matchedExisting: boolean };

export function readWebchatMeta(meta: unknown): WebchatMeta | null {
  const w = (meta as { webchat?: unknown } | null | undefined)?.webchat;
  if (!w || typeof w !== "object") return null;
  const { chat_id, index, locale, matched_existing } = w as Record<string, unknown>;
  if (typeof chat_id !== "string" || !chat_id || typeof index !== "number" || !Number.isInteger(index) || index < 0) return null;
  return { chatId: chat_id, index, locale: locale === "es" ? "es" : "en", matchedExisting: matched_existing === true };
}

/** §5a: the id of each chat's FIRST row on this thread (its lowest index), where its one line sits. */
export function firstWebchatRows(messages: readonly { id: string; channel: string; meta?: unknown }[]): Set<string> {
  const first = new Map<string, { id: string; index: number }>();
  for (const msg of messages) {
    if (msg.channel !== "webchat") continue;
    const w = readWebchatMeta(msg.meta);
    if (!w) continue;
    const seen = first.get(w.chatId);
    if (!seen || w.index < seen.index) first.set(w.chatId, { id: msg.id, index: w.index });
  }
  return new Set([...first.values()].map((x) => x.id));
}
