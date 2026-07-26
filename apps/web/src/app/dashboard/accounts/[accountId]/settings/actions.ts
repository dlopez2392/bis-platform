"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/auth";
import { serviceDb, createCustomField, upsertCustomValue, type CustomFieldDef } from "@bis/db";

export async function createFieldAction(formData: FormData): Promise<void> {
  await requireAgency();
  const accountId = String(formData.get("accountId") ?? "");
  const dataType = String(formData.get("dataType")) as CustomFieldDef["data_type"];
  const options = String(formData.get("options") ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  await createCustomField(serviceDb(), accountId, {
    model: "contact",
    fieldKey: String(formData.get("fieldKey") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    dataType, options: options.length ? options : undefined,
  });
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
}

export async function upsertValueAction(formData: FormData): Promise<void> {
  await requireAgency();
  const accountId = String(formData.get("accountId") ?? "");
  await upsertCustomValue(serviceDb(), accountId, {
    valueKey: String(formData.get("valueKey") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    value: String(formData.get("value") ?? ""),
  });
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
}
