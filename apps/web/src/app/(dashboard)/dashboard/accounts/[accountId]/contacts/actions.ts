"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { createContact } from "@bis/db";

export async function createContactAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAccountAccess(accountId);
  const val = (k: string) => String(formData.get(k) ?? "").trim() || undefined;
  await createContact(await dbForRequest(), accountId, {
    firstName: val("firstName"), lastName: val("lastName"),
    email: val("email"), phone: val("phone"),
  }, userId);
  revalidatePath(`/dashboard/accounts/${accountId}/contacts`);
}
