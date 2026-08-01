"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/auth";
import { serviceDb, captureBlueprint } from "@bis/db";

export async function captureBlueprintAction(
  accountId: string, formData: FormData,
): Promise<void> {
  const { userId } = await requireAgency();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("blueprint name required");

  await captureBlueprint(serviceDb(), accountId, { name }, userId);

  revalidatePath("/dashboard/blueprints");
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
}
