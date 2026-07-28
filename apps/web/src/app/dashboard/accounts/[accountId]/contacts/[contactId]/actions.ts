"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/auth";
import { serviceDb, updateContact, addTagToContact, removeTagFromContact,
         addNote, addTask, completeTask, listCustomFields } from "@bis/db";
import { CLEAR_FIELD_SENTINEL } from "./constants";

function ids(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  if (!accountId || !contactId) throw new Error("ids missing");
  return { accountId, contactId, path: `/dashboard/accounts/${accountId}/contacts/${contactId}` };
}

export async function updateContactAction(formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const { accountId, contactId, path } = ids(formData);
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

export async function addTagAction(formData: FormData): Promise<void> {
  await requireAgency();
  const { accountId, contactId, path } = ids(formData);
  const tag = String(formData.get("tag") ?? "");
  if (tag.trim()) await addTagToContact(serviceDb(), accountId, contactId, tag);
  revalidatePath(path);
}

export async function removeTagAction(formData: FormData): Promise<void> {
  await requireAgency();
  const { accountId, contactId, path } = ids(formData);
  await removeTagFromContact(serviceDb(), accountId, contactId, String(formData.get("tagId")));
  revalidatePath(path);
}

export async function addNoteAction(formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const { accountId, contactId, path } = ids(formData);
  const body = String(formData.get("body") ?? "").trim();
  if (body) await addNote(serviceDb(), accountId, contactId, body, userId);
  revalidatePath(path);
}

export async function addTaskAction(formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const { accountId, contactId, path } = ids(formData);
  const title = String(formData.get("title") ?? "").trim();
  const dueAt = String(formData.get("dueAt") ?? "");
  if (title) await addTask(serviceDb(), accountId,
    { contactId, title, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined }, userId);
  revalidatePath(path);
}

export async function completeTaskAction(formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const { accountId, path } = ids(formData);
  await completeTask(serviceDb(), accountId, String(formData.get("taskId")), userId);
  revalidatePath(path);
}
