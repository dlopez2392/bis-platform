import type { AuthorKind, TimelineEntry } from "@bis/db";
import type { Tr } from "./copy";

export type AuthorMarkView = { kind: AuthorKind; label: string };
/** `viewerId` is the signed-in person's Clerk id (requireAccountAccess's userId), the same id every
 *  person column stores; `names` comes from ONE listPeopleNames read on the request client. */
export type AuthorCtx = { viewerId: string | null; names: Readonly<Record<string, string>>; personaName: string | null; tr: Tr };

// The closed set (DESIGN.md, Provenance), keyed by @bis/db's AuthorKind, so a sixth or a dropped kind
// is a compile error here. Type-locked rather than a value import of AUTHOR_KINDS: the contact page's
// tests mock @bis/db with explicit factories, where an unlisted AUTHOR_KINDS would be undefined.
const KINDS: Readonly<Record<AuthorKind, true>> = { person: true, ai: true, automation: true, customer: true, import: true };
const isAuthorKind = (v: unknown): v is AuthorKind => typeof v === "string" && Object.hasOwn(KINDS, v);
/** A column outside the five (bad data) is the person mark, unnamed: never a sixth kind, never blank. */
const unnamed = (): { kind: AuthorKind; personId: string | null } => ({ kind: "person", personId: null });

/**
 * Who made a row (spec §6): the kind, from the row's own columns (0073; NOT NULL on messages and
 * bookings since 0074, so a real row can no longer be missing it). The old NULL-era default (an
 * inbound message the customer's, an outbound one a person's, D9; a booking the customer's, the
 * booking page being its common maker) is gone with it — `isAuthorKind`/`unnamed` below are not
 * specific to NULL, so they stay as the one defence against any value outside the closed five,
 * null included (a corrupt row; a column read through an unsafe cast, as a test still does).
 */
export function authorOf(entry: TimelineEntry): { kind: AuthorKind; personId: string | null } {
  switch (entry.kind) {
    case "note": return { kind: "person", personId: entry.note.author_id };
    case "task":
      if (entry.task.call_id) return { kind: "ai", personId: null };
      if (entry.task.consent_event_id) return { kind: "automation", personId: null };
      return { kind: "person", personId: entry.task.created_by };
    case "deal": return { kind: "person", personId: entry.deal.created_by };
    case "submission": {
      const kind: unknown = entry.submission.author_kind;
      return isAuthorKind(kind) ? { kind, personId: null } : unnamed();
    }
    case "message": {
      const kind: unknown = entry.message.author_kind;
      if (!isAuthorKind(kind)) return unnamed();
      return { kind, personId: kind === "person" ? entry.message.author_id : null };
    }
    case "booking": {
      const kind: unknown = entry.booking.author_kind;
      if (!isAuthorKind(kind)) return unnamed();
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
