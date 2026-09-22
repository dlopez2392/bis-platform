"use server";

import { clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/auth";
import { serviceDb, createAccount, applyBlueprint, assertUsableZone, isTestOrgId } from "@bis/db";
import { NO_BLUEPRINT_SENTINEL } from "./constants";

export async function createClientAccount(formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "America/Chicago");
  if (!name) throw new Error("Account name is required");
  // BEFORE the Clerk org is created, not after. createAccount refuses an
  // unusable zone on its own — that is the invariant no caller can bypass —
  // but by the time it runs this action has already made an organisation in
  // Clerk and would have to delete it again through the compensating
  // rollback below. A typo in a form field should not create and destroy a
  // tenant in an external system.
  assertUsableZone(timezone);

  const clerk = await clerkClient();
  const org = await clerk.organizations.createOrganization({ name, createdBy: userId });
  let id: string;
  try {
    // Refused HERE, and deliberately not inside createAccount: this is the one
    // door a Clerk-issued org id enters production through, while createAccount
    // is called with an org_test_ id on purpose by every fixture in the repo,
    // so a guard down there would fail the suites it is meant to protect.
    // Inside the try so the compensating rollback below takes the Clerk org
    // with it — the fixture sweep deletes any account carrying this prefix once
    // it is an hour old (packages/db/src/test/sweep-fixtures.ts), so a
    // test-shaped id that became a real tenant would be a business's account
    // quietly disappearing overnight.
    if (isTestOrgId(org.id)) {
      throw new Error(
        "We could not create this account. The new organization came back with an id " +
        "we reserve for test data, and accounts with that kind of id are deleted " +
        "automatically an hour later. Nothing was saved. Please try again, and tell " +
        "the BIS team if it happens twice.");
    }
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
