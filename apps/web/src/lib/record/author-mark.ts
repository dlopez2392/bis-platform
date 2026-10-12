import type { AuthorKind, TimelineEntry } from "@bis/db";
import type { Tr } from "./copy";

export type AuthorMarkView = { kind: AuthorKind; label: string };
/** `viewerId` is the signed-in person's Clerk id (requireAccountAccess's userId), the same id every
 *  person column stores; `names` comes from ONE listPeopleNames read on the request client. */
export type AuthorCtx = { viewerId: string | null; names: Readonly<Record<string, string>>; personaName: string | null; tr: Tr };

/**
 * Who made a row (spec §6): the kind, from the row's own columns (0073), and the person to name.
 * A NULL author_kind exists only for a row the build before 1b wrote, until 0074; it reads as the
 * backfill's own default (an inbound message the customer's, an outbound one a person's, D9; a
 * booking the customer's, the booking page being its common maker).
 */
export function authorOf(entry: TimelineEntry): { kind: AuthorKind; personId: string | null } {
  switch (entry.kind) {
    case "note": return { kind: "person", personId: entry.note.author_id };
    case "task":
      if (entry.task.call_id) return { kind: "ai", personId: null };
      if (entry.task.consent_event_id) return { kind: "automation", personId: null };
      return { kind: "person", personId: entry.task.created_by };
    case "deal": return { kind: "person", personId: entry.deal.created_by };
    case "submission": return { kind: entry.submission.author_kind, personId: null };
    case "message": {
      const kind = entry.message.author_kind ?? (entry.message.direction === "inbound" ? "customer" : "person");
      return { kind, personId: kind === "person" ? entry.message.author_id : null };
    }
    case "booking": {
      const kind = entry.booking.author_kind ?? "customer";
      return { kind, personId: kind === "person" ? entry.booking.author_id : null };
    }
    case "call": return { kind: "ai", personId: null };
  }
}

/** The mark's word. A person the reader cannot name (a departed member, the agency read by a client,
 *  a seed) is "Someone on the team", still the person mark (D10, D11); never a sixth kind. */
export function authorLabel(kind: AuthorKind, personId: string | null, ctx: AuthorCtx): string {
  const { tr } = ctx;
  switch (kind) {
    case "person": {
      if (personId && ctx.viewerId && personId === ctx.viewerId) return tr.text("provenance.you");
      const named = personId && Object.hasOwn(ctx.names, personId) ? ctx.names[personId] : undefined;
      return named || tr.text("assign.someone");
    }
    case "ai": return tr.text("provenance.ai", { name: ctx.personaName?.trim() || "Sofía" });
    case "automation": return tr.text("provenance.automation");
    case "customer": return tr.text("provenance.customer");
    case "import": return tr.text("provenance.import");
  }
}

export function authorMark(entry: TimelineEntry, ctx: AuthorCtx): AuthorMarkView {
  const { kind, personId } = authorOf(entry);
  return { kind, label: authorLabel(kind, personId, ctx) };
}

/** The distinct person ids a page's marks name: what the one names read asks for. */
export function personIdsOf(entries: readonly TimelineEntry[]): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    const { kind, personId } = authorOf(entry);
    if (kind === "person" && personId) ids.add(personId);
  }
  return [...ids];
}
