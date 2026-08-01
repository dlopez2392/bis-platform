"use server";

import { clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/auth";
import { serviceDb, createAccount, applyBlueprint } from "@bis/db";
import { NO_BLUEPRINT_SENTINEL } from "./constants";

export async function createClientAccount(formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "America/Chicago");
  if (!name) throw new Error("Account name is required");

  const clerk = await clerkClient();
  const org = await clerk.organizations.createOrganization({ name, createdBy: userId });
  let id: string;
  try {
    ({ id } = await createAccount(serviceDb(), { clerkOrgId: org.id, name, timezone, actorId: userId }));
  } catch (err) {
    // compensating rollback: never leave a Clerk org without a tenant row
    await clerk.organizations.deleteOrganization(org.id).catch(() => {});
    throw err;
  }

  // The sentinel stands in for "no blueprint chosen" — Radix Select cannot
  // post an empty-string item value, so the dialog submits the sentinel
  // instead of "" when nothing is picked (see ./constants.ts).
  const rawBlueprintId = String(formData.get("blueprintId") ?? "").trim();
  const blueprintId = rawBlueprintId === NO_BLUEPRINT_SENTINEL ? "" : rawBlueprintId;
  if (blueprintId) {
    // Deliberately after creation and deliberately non-fatal: the company is
    // already real, and apply is idempotent, so the remedy for a partial run is
    // to apply again rather than to lose the account.
    try {
      const report = await applyBlueprint(serviceDb(), id, blueprintId, userId);
      if (report.failed.length > 0) {
        console.error(`blueprint ${blueprintId} partially applied to ${id}:`,
          report.failed.map((f) => `${f.key}: ${f.error}`).join("; "));
      }
    } catch (e) {
      console.error(`blueprint apply failed for account ${id}: ${String(e)}`);
    }
  }

  revalidatePath("/dashboard/accounts");
  redirect(`/dashboard/accounts/${id}/checklist`);
}
