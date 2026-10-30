"use server";

import { redirect } from "next/navigation";
import { isAgencyVisitReason } from "@bis/db";
import { requireAgency, accountHome } from "@/lib/auth";
import { isUuid } from "@/lib/assign/action-guards";
import { safeReturnPath, enterHref } from "@/lib/access-log/paths";
import { startVisitForCaller } from "@/lib/access-log/visit";
import { agencyVisitMissing } from "@/lib/access-log/gate";

/**
 * F-118 part 1 (spec 3.2, plan Task 5). Posted by the chooser's four reason tiles, bound with
 * `(accountId, to)`. Both bound arguments come back from the browser unencrypted, so neither is trusted:
 * `accountId` is re-checked as a UUID, and `to` is re-validated through `safeReturnPath` (never built
 * into a redirect unvalidated — a path into another account, or one crossing into it through `//`, `\`
 * or a dot segment, is dropped to this account's own home instead). `reason` is checked against the
 * closed list before `startVisitForCaller` is ever called, so an unknown or missing reason starts
 * nothing and sends the caller back to the chooser with the safe `to` preserved — unless a visit is
 * already live, when the chooser would only bounce them straight back: then they go to `to` (or home).
 */
export async function startVisitAction(
  accountId: string, to: string | null, formData: FormData,
): Promise<void> {
  await requireAgency();
  if (!isUuid(accountId)) redirect("/dashboard/accounts");
  const back = safeReturnPath(to, accountId);
  const reason = formData.get("reason");
  if (!isAgencyVisitReason(reason)) {
    // The agency refresh loop (2026-10-30): with a visit ALREADY live, the chooser only redirects straight
    // back, so sending the caller there is a second loop path. Go where they were going instead. A failed
    // read is the chooser, as before (fail closed: never into the account on an unknown answer).
    const live = await agencyVisitMissing(accountId).then((missing) => !missing, () => false);
    redirect(live ? back ?? accountHome(accountId, null) : enterHref(accountId, back));
  }
  const visit = await startVisitForCaller(accountId, reason);
  if (!visit) redirect("/dashboard/accounts");
  redirect(back ?? accountHome(accountId, null));
}
