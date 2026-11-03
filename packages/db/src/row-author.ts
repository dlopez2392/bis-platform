import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorType } from "./events";
import type { RowAuthor } from "./provenance";
import { SEED_ACTORS } from "./provenance";
import { isUserClient } from "./user-client";

/**
 * F-115: the header 0111's app.record_changes_capture() reads on a service-role request (migration
 * 0111, precedence step 4). The plan's own doc comment on this constant (row-author.ts) is the single
 * source other files quote.
 */
export const AUTHOR_HEADER = "x-bis-author";

/**
 * The JSON 0111 expects on x-bis-author: {"kind":…, "id"?:…, "via"?:…}. Throws on a person with no
 * id — `author_id` is required for `person` (0111's own CHECK, record_changes_author_id), and a
 * header that could never be honoured is a bug at the call site, not a value worth sending.
 */
export function authorHeaderValue(author: RowAuthor, via?: string): string {
  if (author.authorKind === "person" && !author.authorId) {
    throw new Error("withAuthor: a person author needs an id");
  }
  return JSON.stringify({
    kind: author.authorKind,
    ...(author.authorId ? { id: author.authorId } : {}),
    ...(via ? { via } : {}),
  });
}

/**
 * Attach who made this write to ONE query. Harmless on a user client: 0111's capture takes the
 * token's own sub on that path (precedence step 1/3), and never reads this header at all unless the
 * session role is service_role.
 */
export function withAuthor<B extends { setHeader(name: string, value: string): B }>(
  builder: B, author: RowAuthor, via?: string,
): B {
  return builder.setHeader(AUTHOR_HEADER, authorHeaderValue(author, via));
}

/**
 * The runtime half of "required": a JS caller (or a `as never` cast past the compile-time pin) cannot
 * skip the author on a service client. A user client needs none — the database takes the token there
 * (0111 precedence step 1/3) — so this is a no-op (returns `undefined`) when `db` is a user client.
 */
export function requireAuthor(db: SupabaseClient, author: RowAuthor | undefined, writer: string): RowAuthor {
  if (!author && !isUserClient(db)) {
    throw new Error(`${writer}: a server write must say who made it`);
  }
  return author as RowAuthor;
}

/**
 * The exact inverse of `contactAuthor` for every pair it can produce (pinned by row-author.test.ts):
 * used by every converted writer so `emit()` keeps recording a sensible (actorId, actorType) for the
 * OLD events ledger, derived from the SAME `RowAuthor` the write now carries, rather than a second,
 * independently-chosen value that could drift from it.
 */
export function eventActorOf(author: RowAuthor): { actorId: string; actorType: ActorType } {
  switch (author.authorKind) {
    case "person":
      return { actorType: "user", actorId: author.authorId ?? "" };
    case "ai":
      return { actorType: "ai", actorId: author.authorId ?? "ai" };
    case "import":
      // SEED_ACTORS[0] is not "ai" and not "user", so contactAuthor(eventActorOf(import).actorType, …)
      // re-reads it as import again (contactAuthor checks the seed-actor id before the "user" branch).
      return { actorType: "system", actorId: author.authorId ?? SEED_ACTORS[0] };
    case "customer":
      return { actorType: "system", actorId: author.authorId ?? "customer" };
    case "automation":
      return { actorType: "system", actorId: author.authorId ?? "automation" };
  }
}
