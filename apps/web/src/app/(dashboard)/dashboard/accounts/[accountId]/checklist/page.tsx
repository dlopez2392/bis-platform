import { listChecklistState, countFormsMissingNotify, getA2pRegistration } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { mergeChecklist } from "@/lib/checklist-catalogue";
import { Notice } from "@/components/ui/notice";
import { m } from "@/lib/messages";
import { safeZone } from "@/lib/booking/time";
import { formatDateInZone } from "@/lib/format";
import { ChecklistPanel } from "./checklist-panel";
import { A2pPanel } from "./a2p-panel";
import { setChecklistItemAction, addChecklistItemAction, setA2pRegistrationAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ChecklistPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ apply?: string }>;
}) {
  const { accountId } = await params;
  const { apply } = await searchParams;
  await requireAgencyOnlyAccountAccess(accountId);
  const db = await dbForRequest();
  // The READS stay on dbForRequest() — RLS is right there and correct. Only
  // the A2P WRITE needs serviceDb (see setA2pRegistrationAction): `a2p_*` is
  // selectable by `authenticated`, just not updatable.
  const [rows, formsMissingNotify, a2p, account] = await Promise.all([
    listChecklistState(db, accountId),
    countFormsMissingNotify(db, accountId),
    getA2pRegistration(db, accountId),
    // Only for rendering the A2P timestamp in the ACCOUNT's zone rather than
    // whatever clock the operator's browser is on — the repeated timezone
    // defect in this codebase. `accounts.timezone` is free-text at creation
    // (no DB-level IANA validation), so it goes through safeZone like every
    // other reader of this column.
    db.from("accounts").select("timezone").eq("id", accountId).maybeSingle(),
  ]);
  if (account.error) {
    throw new Error(`checklist: account lookup failed: ${account.error.message}`);
  }
  // A null row falls through to the "UTC" fallback rather than throwing, which
  // is a DELIBERATE divergence from calls/page.tsx and calendar/page.tsx (both
  // throw "account not found" here). requireAgencyOnlyAccountAccess above has
  // already proved the row exists, and 500ing the whole checklist over one
  // cosmetic date line would be the worse failure. Do not "fix" this to a throw.
  const timezone = safeZone(
    (account.data as { timezone: string } | null)?.timezone, "UTC");
  // formatDateInZone, NOT formatWhen: that formatter emits no year, so a
  // registration recorded in 2025 and one recorded in 2026 would render
  // identically — on the one field whose job is telling a fresh filing from a
  // stale one. See the note on formatCallTime; formatWhen must not gain a year
  // because it is also spoken aloud on live calls.
  const recordedAt = a2p?.updatedAt
    ? formatDateInZone(a2p.updatedAt, timezone)
    : null;
  return (
    <>
      <PageHeader title={m["checklist.title"]} />
      <div className="max-w-2xl space-y-4 p-6">
        {apply === "partial" ? (
          <Notice tone="warn">{m["accounts.blueprintPartial"]}</Notice>
        ) : null}
        <ChecklistPanel
          entries={mergeChecklist(rows, { a2pStatus: a2p?.status })}
          formsMissingNotify={formsMissingNotify}
          setAction={setChecklistItemAction.bind(null, accountId)}
          addAction={addChecklistItemAction.bind(null, accountId)}
        />
        <A2pPanel
          registration={a2p}
          recordedAt={recordedAt}
          action={setA2pRegistrationAction.bind(null, accountId)}
        />
      </div>
    </>
  );
}
