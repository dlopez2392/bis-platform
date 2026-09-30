"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { updateContact, addTagToContact, removeTagFromContact,
         addNote, addTask, completeTask, listCustomFields, HoldUndecidedError } from "@bis/db";
import { CLEAR_FIELD_SENTINEL } from "./constants";

function ids(accountId: string, formData: FormData) {
  const contactId = String(formData.get("contactId") ?? "");
  if (!contactId) throw new Error("contactId missing");
  return { contactId, path: `/dashboard/accounts/${accountId}/contacts/${contactId}` };
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
  if (title) await addTask(await dbForRequest(), accountId,
    { contactId, title, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined }, userId);
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
