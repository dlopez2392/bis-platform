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
  // Carried to the setup page via a query param so a failed or partial
  // apply is never invisible: before this, a total failure (the `catch`
  // below) or a partial one (`report.failed.length > 0`) both ended on the
  // exact same "success" redirect a clean apply does, and the only trace was
  // a `console.error` nobody but the running server ever sees.
  let applyOutcome: "ok" | "partial" = "ok";
  if (blueprintId) {
    // Deliberately after creation and deliberately non-fatal: the company is
    // already real, and apply is idempotent, so the remedy for a partial run is
    // to apply again rather than to lose the account.
    try {
      const report = await applyBlueprint(serviceDb(), id, blueprintId, userId);
      if (report.failed.length > 0) {
        applyOutcome = "partial";
        console.error(`blueprint ${blueprintId} partially applied to ${id}:`,
          report.failed.map((f) => `${f.key}: ${f.error}`).join("; "));
      }
    } catch (e) {
      applyOutcome = "partial";
      console.error(`blueprint apply failed for account ${id}: ${String(e)}`);
    }
  }

  revalidatePath("/dashboard/accounts");
  // The setup wizard, not the checklist: a brand-new account has nothing on
  // it, and the wizard is the surface that says — from live rows rather than
  // from a list of reminders — what is missing and where to go and do it.
  // The checklist route stays reachable and keeps its own copy of the banner
  // below; it is just no longer where onboarding lands.
  redirect(`/dashboard/accounts/${id}/setup${applyOutcome === "partial" ? "?apply=partial" : ""}`);
}
