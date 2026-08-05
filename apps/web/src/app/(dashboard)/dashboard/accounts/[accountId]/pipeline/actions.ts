"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { createOpportunity, moveOpportunityToStage, updateOpportunity } from "@bis/db";

function pathFor(accountId: string) {
  return `/dashboard/accounts/${accountId}/pipeline`;
}

export async function createOpportunityAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAccountAccess(accountId);
  const name = String(formData.get("name") ?? "").trim();
  const contactId = String(formData.get("contactId") ?? "");
  const pipelineId = String(formData.get("pipelineId") ?? "");
  if (!name || !contactId || !pipelineId) throw new Error("name, contact, pipeline required");
  await createOpportunity(await dbForRequest(), accountId,
    { contactId, pipelineId, name, value: Number(formData.get("value") ?? 0) || 0 }, userId);
  revalidatePath(pathFor(accountId));
}

export async function moveOppToStageAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAccountAccess(accountId);
  const oppId = String(formData.get("oppId") ?? "");
  const toStageId = String(formData.get("toStageId") ?? "");
  if (!oppId || !toStageId) throw new Error("oppId and toStageId required");
  await moveOpportunityToStage(await dbForRequest(), accountId, oppId, toStageId, userId);
  revalidatePath(pathFor(accountId));
}

export async function updateOpportunityAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAccountAccess(accountId);
  const oppId = String(formData.get("oppId") ?? "");
  if (!oppId) throw new Error("oppId required");
  const status = String(formData.get("status") ?? "");
  if (status && status !== "open" && status !== "won" && status !== "lost") {
    throw new Error("bad status");
  }
  const rawValue = formData.get("value");
  await updateOpportunity(
    await dbForRequest(),
    accountId,
    oppId,
    {
      name: String(formData.get("name") ?? "").trim() || undefined,
      value: rawValue === null || rawValue === "" ? undefined : Number(rawValue),
      status: (status || undefined) as "open" | "won" | "lost" | undefined,
    },
    userId,
  );
  revalidatePath(pathFor(accountId));
}
