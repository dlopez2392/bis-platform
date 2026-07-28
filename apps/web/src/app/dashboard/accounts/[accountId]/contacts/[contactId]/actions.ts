"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/auth";
import { serviceDb, updateContact, addTagToContact, removeTagFromContact,
         addNote, addTask, completeTask, listCustomFields } from "@bis/db";
import { CLEAR_FIELD_SENTINEL } from "./constants";

function ids(accountId: string, formData: FormData) {
  const contactId = String(formData.get("contactId") ?? "");
  if (!contactId) throw new Error("contactId missing");
  return { contactId, path: `/dashboard/accounts/${accountId}/contacts/${contactId}` };
}

export async function updateContactAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const { contactId, path } = ids(accountId, formData);
  const db = serviceDb();
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
  await requireAgency();
  const { contactId, path } = ids(accountId, formData);
  const tag = String(formData.get("tag") ?? "");
  if (tag.trim()) await addTagToContact(serviceDb(), accountId, contactId, tag);
  revalidatePath(path);
}

export async function removeTagAction(accountId: string, formData: FormData): Promise<void> {
  await requireAgency();
  const { contactId, path } = ids(accountId, formData);
  await removeTagFromContact(serviceDb(), accountId, contactId, String(formData.get("tagId")));
  revalidatePath(path);
}

export async function addNoteAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const { contactId, path } = ids(accountId, formData);
  const body = String(formData.get("body") ?? "").trim();
  if (body) await addNote(serviceDb(), accountId, contactId, body, userId);
  revalidatePath(path);
}

export async function addTaskAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const { contactId, path } = ids(accountId, formData);
  const title = String(formData.get("title") ?? "").trim();
  const dueAt = String(formData.get("dueAt") ?? "");
  if (title) await addTask(serviceDb(), accountId,
    { contactId, title, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined }, userId);
  revalidatePath(path);
}

export async function completeTaskAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const { path } = ids(accountId, formData);
  await completeTask(serviceDb(), accountId, String(formData.get("taskId")), userId);
  revalidatePath(path);
}
