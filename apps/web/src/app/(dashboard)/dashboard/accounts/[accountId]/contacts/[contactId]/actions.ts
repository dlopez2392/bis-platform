"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { renderZone } from "@/lib/zone";
import { zonedTimeToUtc } from "@/lib/booking/slots";
import { updateContact, addTagToContact, removeTagFromContact,
         addNote, addTask, completeTask, listCustomFields, HoldUndecidedError } from "@bis/db";
import { CLEAR_FIELD_SENTINEL } from "./constants";

function ids(accountId: string, formData: FormData) {
  const contactId = String(formData.get("contactId") ?? "");
  if (!contactId) throw new Error("contactId missing");
  return { contactId, path: `/dashboard/accounts/${accountId}/contacts/${contactId}` };
}

/**
 * D-006: the "Add task" due date (`<Input name="dueAt" type="date">` in
 * `activity-timeline.tsx`) is a calendar day, not an instant — the picker
 * carries no hour. The OLD code stored it as `new Date(dueAt).toISOString()`,
 * which `Date`'s own date-only parsing resolves to UTC MIDNIGHT. The To do
 * screen (`tasks/work-list.tsx`'s `rowDateText`) renders every task's
 * `dueAt` through `formatDateInZone` in the ACCOUNT's own zone — correctly,
 * per that screen's own pinned test ("stamps the row's date in the
 * ACCOUNT's zone, not the server's") for a row whose `dueAt` is a real
 * instant, e.g. `dismiss-date.ts`'s "tomorrow at 9am in the account's zone".
 * UTC midnight is not such an instant: in any zone behind UTC (every account
 * on this platform today — `zone-resolution.ts`'s own doc: "every account on
 * this platform today is in the Rio Grande Valley") it reads as the previous
 * evening, so the day rolls back by one on that screen.
 *
 * The fix matches `dismiss-date.ts`'s own precedent for "a real due instant
 * in the account's own zone" (`zonedTimeToUtc`) instead of a bare
 * `new Date()` parse: midnight of the PICKED calendar day, converted from
 * the account's own zone to UTC. Falls back to the old UTC-midnight instant
 * only if the account's zone is unresolvable to a usable one at all (never
 * happens today — `renderZone` is total by construction) or the picked wall
 * time doesn't exist in that zone (midnight is never inside a US DST gap,
 * which lands at 2 a.m.) — degrade, don't drop the date the operator typed.
 */
async function dueAtInAccountZone(
  db: Awaited<ReturnType<typeof dbForRequest>>,
  accountId: string,
  dueAt: string,
): Promise<string> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueAt);
  if (!match) return new Date(dueAt).toISOString();
  const [, yStr, mStr, dStr] = match;
  const y = Number(yStr);
  const mo = Number(mStr);
  const d = Number(dStr);
  const { data } = await db.from("accounts").select("timezone").eq("id", accountId).maybeSingle();
  const zone = await renderZone((data as { timezone: string | null } | null)?.timezone ?? undefined);
  const at = zonedTimeToUtc(y, mo, d, 0, 0, zone.zone);
  return (at ?? new Date(dueAt)).toISOString();
}

export async function updateContactAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAccountAccess(accountId);
  const { contactId, path } = ids(accountId, formData);
  const db = await dbForRequest();
  const defs = await listCustomFields(db, accountId, "contact");
  const custom: Record<string, unknown> = {};
  for (const d of defs) {
    const raw = formData.get(`cf_${d.field_key}`);
    if (d.data_type === "checkbox") custom[d.field_key] = raw === "on";
    else if (raw !== null && String(raw) !== "" && String(raw) !== CLEAR_FIELD_SENTINEL) custom[d.field_key] =
      d.data_type === "number" ? Number(raw) : String(raw);
  }
  const val = (k: string) => {
    const v = formData.get(k);
    return v === null ? undefined : String(v).trim();
  };
  await updateContact(db, accountId, contactId, {
    firstName: val("firstName"), lastName: val("lastName"),
    email: val("email"), phone: val("phone"), companyName: val("companyName"),
    custom,
  }, userId);
  revalidatePath(path);
}

export async function addTagAction(accountId: string, formData: FormData): Promise<void> {
  await requireAccountAccess(accountId);
  const { contactId, path } = ids(accountId, formData);
  const tag = String(formData.get("tag") ?? "");
  if (tag.trim()) await addTagToContact(await dbForRequest(), accountId, contactId, tag);
  revalidatePath(path);
}

export async function removeTagAction(accountId: string, formData: FormData): Promise<void> {
  await requireAccountAccess(accountId);
  const { contactId, path } = ids(accountId, formData);
  await removeTagFromContact(await dbForRequest(), accountId, contactId, String(formData.get("tagId")));
  revalidatePath(path);
}

export async function addNoteAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAccountAccess(accountId);
  const { contactId, path } = ids(accountId, formData);
  const body = String(formData.get("body") ?? "").trim();
  if (body) await addNote(await dbForRequest(), accountId, contactId, body, userId);
  revalidatePath(path);
}

export async function addTaskAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAccountAccess(accountId);
  const { contactId, path } = ids(accountId, formData);
  const title = String(formData.get("title") ?? "").trim();
  const dueAt = String(formData.get("dueAt") ?? "");
  const db = await dbForRequest();
  const dueAtIso = dueAt ? await dueAtInAccountZone(db, accountId, dueAt) : undefined;
  if (title) await addTask(db, accountId, { contactId, title, dueAt: dueAtIso }, userId);
  revalidatePath(path);
}

export async function completeTaskAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAccountAccess(accountId);
  const { path } = ids(accountId, formData);
  try {
    await completeTask(await dbForRequest(), accountId, String(formData.get("taskId")), userId);
  } catch (e) {
    // Review R3-I1, R3-N1: a hold's To-do is closed by deciding the hold,
    // and the timeline shows a hint instead of Done for one (Task 12), so
    // this is a stale page. Re-render (the hint appears) rather than show an
    // error page. The decision is on the To-do page, and in the Texts row
    // while the contact's current number is the one on hold.
    if (!(e instanceof HoldUndecidedError)) throw e;
  }
  revalidatePath(path);
}
