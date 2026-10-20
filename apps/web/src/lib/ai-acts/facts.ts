import { aiContactHeldBy, getContact, lastFieldEditor, type BookingStatus, type SupabaseClient } from "@bis/db";
import type { AiAct } from "@bis/db/ai-act-rules";
import { stillAsWritten } from "@/lib/proposals/kinds/contact-field";
import { FIELD_COLUMN } from "./kinds/contact-field-filled";
import type { ActBookingFact, ActFacts } from "./kinds/types";

/**
 * Everything the act-kind registry's `stillSafe` needs for one page of a record's timeline, read ONCE (item
 * 8c, plan Task 5 item 2), on the REQUEST client, so RLS decides what the reader can see: a Technician who
 * cannot see an overlapping booking may be offered an Undo that 0091's function then refuses as
 * `time_taken`, and the toast says so (plan ambiguity H). Bounded by the page (at most 30 rows):
 *   - the contact's own row (`getContact`);
 *   - ONE `bookings` read by id, and ONE read of the bookings that replaced any of them;
 *   - per booking act whose Undo would put a slot back: one overlap read (`limit 1`);
 *   - the contact's future booked bookings, only when a cancelled-booking act is on the page;
 *   - `ai_contact_held_by` per contact-created act, only for an Owner (or the agency);
 *   - `lastFieldEditor` per field act whose value moved.
 * An undone act needs none of it (its row says who undid it). Every read is scoped by `account_id`.
 * THROWS on a failed read: the loader turns that into every act's `unknown` state, logged.
 */

type BookingRow = {
  id: string; calendar_id: string; status: BookingStatus; starts_at: string; ends_at: string; updated_at: string;
};

async function rows<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(`readActFacts: ${what} failed: ${error.message}`);
  return (data ?? []) as T[];
}

const empty = (now: Date, canDelete: boolean): ActFacts =>
  ({ now, bookings: {}, contact: null, heldBy: {}, editors: {}, canDelete, futureBooked: [] });

export async function readActFacts(
  db: SupabaseClient, accountId: string, contactId: string, acts: readonly AiAct[],
  access: { canDelete: boolean }, now: Date = new Date(),
): Promise<ActFacts> {
  const open = acts.filter((a) => a.undoneAt === null);
  if (open.length === 0) return empty(now, access.canDelete);

  const ids = [...new Set(open.flatMap((a) => {
    if (a.kind === "booking_rescheduled") return [a.target.bookingId, a.target.fromBookingId];
    if (a.kind === "booking_created" || a.kind === "booking_cancelled") return [a.target.bookingId];
    return [];
  }))];

  const [contact, booked, replacements] = await Promise.all([
    getContact(db, accountId, contactId) as Promise<Record<string, unknown> | null>,
    ids.length === 0 ? Promise.resolve([] as BookingRow[])
      : rows<BookingRow>(db.from("bookings").select("id, calendar_id, status, starts_at, ends_at, updated_at")
        .eq("account_id", accountId).in("id", ids), "bookings"),
    ids.length === 0 ? Promise.resolve([] as { id: string; rescheduled_from_id: string }[])
      : rows<{ id: string; rescheduled_from_id: string }>(db.from("bookings").select("id, rescheduled_from_id")
        .eq("account_id", accountId).in("rescheduled_from_id", ids), "replacements"),
  ]);
  const byId = new Map(booked.map((b) => [b.id, b]));
  const replacedBy = new Map(replacements.map((r) => [r.rescheduled_from_id, r.id]));

  // The slot an Undo would book again: a cancelled booking's own, or a move's old one. The move's own new
  // booking never counts against it, because the Undo deletes that one in the same transaction.
  const slotChecks = open.flatMap((a): { bookingId: string; exclude: string[] }[] => {
    if (a.kind === "booking_cancelled") return [{ bookingId: a.target.bookingId, exclude: [a.target.bookingId] }];
    if (a.kind === "booking_rescheduled") return [{ bookingId: a.target.fromBookingId, exclude: [a.target.fromBookingId, a.target.bookingId] }];
    return [];
  }).filter((c) => byId.get(c.bookingId)?.status === "cancelled");

  const fieldActs = open.flatMap((a) => (a.kind === "contact_field_filled" ? [a] : []))
    .filter((a) => !stillAsWritten(a.target.field, contact ? contact[FIELD_COLUMN[a.target.field]] : undefined, a.after.value));
  const contactActs = access.canDelete ? open.filter((a) => a.kind === "contact_created") : [];

  const [taken, futureBooked, held, editors] = await Promise.all([
    Promise.all(slotChecks.map(async (c) => {
      const b = byId.get(c.bookingId)!;
      const hit = await rows<{ id: string }>(db.from("bookings").select("id")
        .eq("account_id", accountId).eq("calendar_id", b.calendar_id).eq("status", "booked")
        .lt("starts_at", b.ends_at).gt("ends_at", b.starts_at)
        .not("id", "in", `(${c.exclude.join(",")})`).limit(1), "overlap");
      return [c.bookingId, hit.length > 0] as const;
    })),
    open.some((a) => a.kind === "booking_cancelled")
      ? rows<{ id: string }>(db.from("bookings").select("id").eq("account_id", accountId).eq("contact_id", contactId)
        .eq("status", "booked").gt("starts_at", now.toISOString()), "future bookings").then((r) => r.map((x) => x.id))
      : Promise.resolve([] as string[]),
    Promise.all(contactActs.map(async (a) => [a.id, await aiContactHeldBy(db, accountId, a.id)] as const)),
    Promise.all(fieldActs.map(async (a) => [a.id, await lastFieldEditor(db, accountId, contactId, a.target.field, a.createdAt)] as const)),
  ]);
  const slotTaken = new Map(taken);

  const bookings: Record<string, ActBookingFact> = {};
  for (const b of booked) {
    bookings[b.id] = {
      status: b.status, startsAt: b.starts_at, endsAt: b.ends_at, updatedAt: b.updated_at,
      replacedBy: replacedBy.get(b.id) ?? null, slotTaken: slotTaken.get(b.id) ?? false,
    };
  }
  return {
    now, bookings, contact: contact ?? null, canDelete: access.canDelete, futureBooked,
    heldBy: Object.fromEntries(held), editors: Object.fromEntries(editors),
  };
}
