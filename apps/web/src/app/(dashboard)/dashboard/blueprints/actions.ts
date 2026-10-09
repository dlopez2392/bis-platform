"use server";

import { revalidatePath } from "next/cache";
import { requireAgency, requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { serviceDb, captureBlueprint, applyBlueprint } from "@bis/db";
import { m } from "@/lib/messages";

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

export type ApplyBlueprintResult =
  | { ok: true; added: number; already: number }
  | { ok: false; error: string };

/**
 * Applies a blueprint to a company that already exists (D-086). Until this,
 * the Add company dialog's "you can apply one later" pointed at no screen.
 *
 * Agency-only, gated first: blueprints are agency IP, and this writes the
 * account's configuration. `accountId` is bound server-side by the Settings
 * page, never a form field.
 *
 * serviceDb(), for the same reason as captureBlueprintAction above and as
 * createClientAccount's own apply: it is the one `applyBlueprint` every
 * caller shares, and the gate on the first line is what stands behind it.
 *
 * `applyBlueprint` is additive and idempotent — it removes nothing and skips
 * anything an earlier apply added — so this is not a destructive action and
 * needs no typed confirmation, and the remedy for a partial run is simply to
 * apply again, which is what the partial copy says.
 */
export async function applyBlueprintAction(
  accountId: string, formData: FormData,
): Promise<ApplyBlueprintResult> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  const blueprintId = String(formData.get("blueprintId") ?? "").trim();
  if (!blueprintId) return { ok: false, error: m["blueprints.apply.pick"] };

  let report: Awaited<ReturnType<typeof applyBlueprint>>;
  try {
    report = await applyBlueprint(serviceDb(), accountId, blueprintId, userId);
  } catch (e) {
    console.error(`applyBlueprintAction: apply of ${blueprintId} to ${accountId} failed: ${String(e)}`);
    return { ok: false, error: m["blueprints.apply.failed"] };
  }

  revalidatePath("/dashboard/blueprints");
  revalidatePath(`/dashboard/accounts/${accountId}`, "layout");

  if (report.failed.length > 0) {
    console.error(`applyBlueprintAction: ${blueprintId} partially applied to ${accountId}:`,
      report.failed.map((f) => `${f.key}: ${f.error}`).join("; "));
    return { ok: false, error: m["blueprints.apply.partial"] };
  }
  return { ok: true, added: report.created.length, already: report.skipped.length };
}
