"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/auth";
import { serviceDb, setChecklistItem, addCustomChecklistItem } from "@bis/db";

export async function setChecklistItemAction(
  accountId: string, formData: FormData,
): Promise<void> {
  const { userId } = await requireAgency();
  const itemKey = String(formData.get("itemKey") ?? "");
  if (!itemKey) throw new Error("itemKey required");

  await setChecklistItem(serviceDb(), accountId, itemKey,
    { done: formData.get("done") === "true" }, userId);

  revalidatePath(`/dashboard/accounts/${accountId}/checklist`);
  revalidatePath(`/dashboard/accounts/${accountId}/dashboard`);
}

export async function addChecklistItemAction(
  accountId: string, formData: FormData,
): Promise<void> {
  // No userId needed: adding an item records no actor. Only completing one
  // does, via done_by.
  await requireAgency();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("title required");

  await addCustomChecklistItem(serviceDb(), accountId, title);

  revalidatePath(`/dashboard/accounts/${accountId}/checklist`);
  revalidatePath(`/dashboard/accounts/${accountId}/dashboard`);
}
