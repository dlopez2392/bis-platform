"use server";

import { clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/auth";
import { serviceDb, createAccount, applyBlueprint, assertUsableZone, isTestOrgId } from "@bis/db";
import { m } from "@/lib/messages";
import { NO_BLUEPRINT_SENTINEL } from "./constants";

/**
 * The repo's Result shape (see `[accountId]/automations/actions.ts`), with one
 * twist: success is never RETURNED. A created account ends in `redirect()`,
 * which throws Next.js's NEXT_REDIRECT control-flow error, and that has to
 * reach the dialog untouched (create-account-feedback.ts rethrows it). What
 * comes back as a value is a refusal the operator can act on; anything else
 * still throws, and the dialog shows its generic line for it.
 */
export type CreateAccountResult = { ok: true } | { ok: false; error: string };

export async function createClientAccount(formData: FormData): Promise<CreateAccountResult> {
  const { userId } = await requireAgency();
  const name = String(formData.get("name") ?? "").trim();
  // The name customers see (owner decision 2026-10-09): its own field, so the
  // business name above stays the agency's private label. It is what the
  // Clerk organisation is created under (invitation emails carry it, D-005)
  // and what brand_name is born as.
  const brandName = String(formData.get("brandName") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "America/Chicago");
  if (!name) return { ok: false, error: m["accounts.nameRequired"] };
  if (!brandName) return { ok: false, error: m["accounts.brandNameRequired"] };
  // The `?? "America/Chicago"` fallback above only covers a MISSING field;
  // a field left empty in the form arrives here as "", which would
  // otherwise fall straight into assertUsableZone below and come back as
  // the unusable-zone copy quoting an empty string. That is a different
  // problem than a typo'd zone, so it gets its own refusal, asking for a
  // value rather than pretending "" was something the operator typed.
  if (!timezone.trim()) return { ok: false, error: m["accounts.timezoneRequired"] };
  // BEFORE the Clerk org is created, not after. createAccount refuses an
  // unusable zone on its own — that is the invariant no caller can bypass —
  // but by the time it runs this action has already made an organisation in
  // Clerk and would have to delete it again through the compensating
  // rollback below. A typo in a form field should not create and destroy a
  // tenant in an external system.
  //
  // The `try` wraps this ONE call and nothing else: widened over the Clerk
  // call below, a Clerk outage would come back to the operator as "that is
  // not a timezone" (actions.test.ts pins that it cannot).
  try {
    assertUsableZone(timezone);
  } catch {
    return { ok: false, error: m["accounts.timezoneUnusable"].replace("{zone}", timezone) };
  }

  const clerk = await clerkClient();
  const org = await clerk.organizations.createOrganization({ name: brandName, createdBy: userId });
  // compensating rollback: never leave a Clerk org without a tenant row.
  // Its own failure is swallowed — the refusal or error the caller gets is
  // what they act on — but logged: a failed rollback here means the Clerk org
  // SURVIVES while the refusal says "Nothing was saved.", and orphans.ts can
  // only surface that later if this log exists to find.
  const rollback = () =>
    clerk.organizations.deleteOrganization(org.id).catch((rollbackErr) => {
      console.error(`compensating rollback failed for org ${org.id}:`, rollbackErr);
    });

  // Refused HERE, and deliberately not inside createAccount: this is the one
  // door a Clerk-issued org id enters production through, while createAccount
  // is called with an org_test_ id on purpose by every fixture in the repo,
  // so a guard down there would fail the suites it is meant to protect.
  // The Clerk org is rolled back BEFORE the refusal returns — the fixture
  // sweep deletes any account carrying this prefix once it is an hour old
  // (packages/db/src/test/sweep-fixtures.ts), so a test-shaped id that became
  // a real tenant would be a business's account quietly disappearing
  // overnight.
  //
  // RETURNED, not thrown (the follow-up this comment used to defer): a throw
  // reached create-account-dialog.tsx as its generic "check the name" toast,
  // which sent the operator to fix a name that was never the problem. The
  // console line keeps the server-side trace the old throw left in the logs.
  if (isTestOrgId(org.id)) {
    console.error(`refused a test-shaped org id from Clerk: ${org.id}`);
    await rollback();
    return { ok: false, error: m["accounts.createRefusedTestOrgId"] };
  }

  let id: string;
  try {
    ({ id } = await createAccount(serviceDb(), { clerkOrgId: org.id, name, brandName, timezone, actorId: userId }));
  } catch (err) {
    await rollback();
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

/**
 * Adopts a half-created company: a Clerk organisation with no `accounts` row
 * behind it (lib/accounts/orphans.ts), usually made from the Clerk dashboard.
 *
 * D-087. The warning's old first remedy was "add the company here with the
 * same name", which runs createClientAccount above and mints a SECOND
 * organisation, leaving everyone already invited in the first one and still
 * unable to sign in. This writes the account row for the organisation that
 * already exists, under its own Clerk name, so those invitations start to
 * work.
 *
 * `orgId` is bound by the accounts page, but a bound argument travels through
 * the browser, so it is not trusted: Clerk is asked for the organisation, and
 * `accounts.clerk_org_id`'s unique constraint refuses one already linked.
 *
 * And unlike createClientAccount there is NO compensating rollback: this
 * action did not create the organisation, so a failed write must never
 * delete it. Same result shape as createClientAccount, so the dialog reuses
 * settleCreateAccount, and success ends in the same redirect to setup.
 */
export async function adoptOrphanOrgAction(
  orgId: string, formData: FormData,
): Promise<CreateAccountResult> {
  const { userId } = await requireAgency();
  const timezone = String(formData.get("timezone") ?? "America/Chicago");
  if (!timezone.trim()) return { ok: false, error: m["accounts.timezoneRequired"] };
  try {
    assertUsableZone(timezone);
  } catch {
    return { ok: false, error: m["accounts.timezoneUnusable"].replace("{zone}", timezone) };
  }

  let org: { id: string; name: string };
  try {
    const clerk = await clerkClient();
    org = await clerk.organizations.getOrganization({ organizationId: orgId });
  } catch (e) {
    console.error(`adoptOrphanOrgAction: Clerk has no organization ${orgId}: ${String(e)}`);
    return { ok: false, error: m["accounts.orphan.adoptGone"] };
  }
  // createClientAccount's reason: the fixture sweep deletes any account on a
  // test-shaped org id within the hour.
  if (isTestOrgId(org.id)) return { ok: false, error: m["accounts.createRefusedTestOrgId"] };

  let id: string;
  try {
    ({ id } = await createAccount(serviceDb(), { clerkOrgId: org.id, name: org.name, timezone, actorId: userId }));
  } catch (e) {
    console.error(`adoptOrphanOrgAction: account write failed for org ${org.id}: ${String(e)}`);
    return { ok: false, error: m["accounts.orphan.adoptFailed"] };
  }

  revalidatePath("/dashboard/accounts");
  redirect(`/dashboard/accounts/${id}/setup`);
}
