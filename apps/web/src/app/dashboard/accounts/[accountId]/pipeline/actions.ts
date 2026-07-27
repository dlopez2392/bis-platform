"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/auth";
import { serviceDb, createOpportunity, moveOpportunityToStage, updateOpportunity } from "@bis/db";

function base(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) throw new Error("accountId missing");
  return { accountId, path: `/dashboard/accounts/${accountId}/pipeline` };
}

export async function createOpportunityAction(formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const { accountId, path } = base(formData);
  const name = String(formData.get("name") ?? "").trim();
  const contactId = String(formData.get("contactId") ?? "");
  const pipelineId = String(formData.get("pipelineId") ?? "");
  if (!name || !contactId || !pipelineId) throw new Error("name, contact, pipeline required");
  await createOpportunity(serviceDb(), accountId,
    { contactId, pipelineId, name, value: Number(formData.get("value") ?? 0) || 0 }, userId);
  revalidatePath(path);
}

export async function moveOppToStageAction(formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const { accountId, path } = base(formData);
  const oppId = String(formData.get("oppId") ?? "");
  const toStageId = String(formData.get("toStageId") ?? "");
  if (!oppId || !toStageId) throw new Error("oppId and toStageId required");
  await moveOpportunityToStage(serviceDb(), accountId, oppId, toStageId, userId);
  revalidatePath(path);
}

export async function updateOpportunityAction(formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const { accountId, path } = base(formData);
  const oppId = String(formData.get("oppId") ?? "");
  if (!oppId) throw new Error("oppId required");
  const status = String(formData.get("status") ?? "");
  if (status && status !== "open" && status !== "won" && status !== "lost") {
    throw new Error("bad status");
  }
  const rawValue = formData.get("value");
  await updateOpportunity(
    serviceDb(),
    accountId,
    oppId,
    {
      name: String(formData.get("name") ?? "").trim() || undefined,
      value: rawValue === null || rawValue === "" ? undefined : Number(rawValue),
      status: (status || undefined) as "open" | "won" | "lost" | undefined,
    },
    userId,
  );
  revalidatePath(path);
}
