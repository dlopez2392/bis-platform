"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/auth";
import { serviceDb, createOpportunity, moveOpportunityStage, setOpportunityStatus } from "@bis/db";

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

export async function moveOppAction(formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const { accountId, path } = base(formData);
  const dir = String(formData.get("direction")) === "left" ? "left" as const : "right" as const;
  await moveOpportunityStage(serviceDb(), accountId, String(formData.get("oppId")), dir, userId);
  revalidatePath(path);
}

export async function setOppStatusAction(formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const { accountId, path } = base(formData);
  const status = String(formData.get("status"));
  if (status !== "open" && status !== "won" && status !== "lost") throw new Error("bad status");
  await setOpportunityStatus(serviceDb(), accountId, String(formData.get("oppId")), status, userId);
  revalidatePath(path);
}
