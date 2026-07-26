"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/auth";
import { serviceDb, createContact } from "@bis/db";

export async function createContactAction(formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) throw new Error("accountId missing");
  const val = (k: string) => String(formData.get(k) ?? "").trim() || undefined;
  await createContact(serviceDb(), accountId, {
    firstName: val("firstName"), lastName: val("lastName"),
    email: val("email"), phone: val("phone"),
  }, userId);
  revalidatePath(`/dashboard/accounts/${accountId}/contacts`);
}
