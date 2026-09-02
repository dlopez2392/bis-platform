import { listAllPhoneNumbers, type PhoneNumberRow } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { deriveSetupStatus, type SetupInputs } from "@/lib/setup/setup-status";
import { gatherSetupInputs } from "@/lib/setup/setup-inputs";
import { buildSetupViews, resolveAssignedNumber, type ReadKey } from "@/lib/setup/setup-view";
import { m } from "@/lib/messages";
import { SetupPanel, type MovableNumber } from "./setup-panel";
import { setSetupTickAction, goLiveAction } from "./actions";
import { moveNumberAction, setNumberStatusAction } from "../voice/actions";

export const dynamic = "force-dynamic";

// A wholly unconfigured tenant's inputs — fed to `deriveSetupStatus` when
// `gatherSetupInputs` itself fails, so the derive function only ever sees
// clean values (never a partial/undefined field) even on the failure path.
// Every step it produces from this reads not-done, which is what `failed`
// below (every key `true` in that case) overrides to "couldn't check" —
// this fallback only shapes deriveSetupStatus's INPUT type, not what the
// page actually renders.
const NEUTRAL_SETUP_INPUTS: SetupInputs = {
  brandName: null, fromEmail: null, calendar: null, profile: null,
  numbers: [], callCount: 0, ticks: { emailSkipped: false, forwardingDone: false },
};

/**
 * The guided path from a bare account row to a receptionist taking real
 * calls.
 *
 * Two rules run through the whole page.
 *
 * ① Every step is DERIVED, on every render, from the rows that actually
 *    decide it (lib/setup/setup-status.ts). Nothing here reads a stored
 *    "step 3 complete" flag, because such a flag drifts: the exit-gate call
 *    that greeted a caller with "no availability" every day came from a
 *    calendar whose `open_hours` had been wiped while everything upstream
 *    still said it was configured.
 *
 * ② A read that FAILS renders its steps as "couldn't check" — never as done,
 *    and never as not-done. `gatherSetupInputs` (lib/setup/setup-inputs.ts)
 *    is the one shared copy of this page's six-source read set — also used
 *    by the sidebar's setup meter and by `goLiveAction`'s own prerequisite
 *    re-check — and it is ATOMIC (its own doc comment explains why: a
 *    partial derivation is not a decision any of its three callers want).
 *    That means this page can no longer isolate WHICH of the six reads
 *    failed the way its own former `Promise.allSettled` block did — a
 *    single failed leg now marks EVERY step "couldn't check" together,
 *    rather than only the step(s) actually behind that one read. Still
 *    conservative (never a false "done" or "to do"), just coarser than
 *    before this task's read-set unification.
 *
 * `dbForRequest()`, not `serviceDb()` — the page runs as the signed-in
 * agency user, on purpose. `serviceDb()` would render identically for an
 * account whose grants are wrong, which is exactly the failure this page
 * exists to catch: the setup wizard should see what its operator sees.
 * `gatherSetupInputs` uses `getCalendarForAccount`, not `getOrCreateCalendar`
 * — looking at a setup page must not CREATE a calendar row as a side effect.
 */
export default async function SetupPage({
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

  // The header's own display name — separate from gatherSetupInputs's six
  // reads (which need brand_name/from_email, not name, and feed the derive
  // function, not the page chrome). Its own failure only means the header
  // omits the name span (same fallback the page always had); it has no
  // bearing on any step's done/not-done/unknown state.
  let accountName: string | null = null;
  try {
    const { data, error } = await db.from("accounts").select("name").eq("id", accountId).maybeSingle();
    if (error) throw new Error(error.message);
    accountName = (data as { name: string } | null)?.name ?? null;
  } catch (e) {
    console.error(`setup: account name lookup failed for account ${accountId}: ${String(e)}`);
  }

  let inputs: SetupInputs;
  let failed: Record<ReadKey, boolean>;
  try {
    inputs = await gatherSetupInputs(db, accountId);
    failed = { account: false, calendar: false, profile: false, numbers: false, ticks: false, calls: false };
  } catch (e) {
    console.error(`setup: gatherSetupInputs failed for account ${accountId}: ${String(e)}`);
    inputs = NEUTRAL_SETUP_INPUTS;
    failed = { account: true, calendar: true, profile: true, numbers: true, ticks: true, calls: true };
  }

  // `hasVoiceProfile` (passed to SetupPanel) reads existence off this, not
  // completeness — see its own doc comment in setup-panel.tsx for why that
  // is the right question for the test-call card specifically.
  const profile = inputs.profile;
  // `gatherSetupInputs`'s declared `numbers` type is narrowed to
  // `Pick<PhoneNumberRow, "status">` (all `deriveSetupStatus` needs) — the
  // array itself is the SAME full rows `listPhoneNumbersForAccount`
  // returned, so `resolveAssignedNumber`/`movableNumbers` below (which also
  // need `id`/`e164`) widen the type back rather than reading the table
  // again. See setup-inputs.ts's own doc comment.
  const numbers = inputs.numbers as Pick<PhoneNumberRow, "id" | "status" | "e164">[];

  const steps = deriveSetupStatus(inputs);

  const { views, prereqsMet } = buildSetupViews(steps, failed);

  // What the client's carrier forwards to, and what a test call dials —
  // three states, not two: `resolveAssignedNumber` returns "unknown" rather
  // than null when the numbers read itself failed, so the forwarding card
  // can tell those apart (setup-panel.tsx).
  const assignedNumber = resolveAssignedNumber(numbers, failed.numbers);

  // Only when the numbers read actually answered "this account has none".
  // Never on `"unknown"`: offering to move a number into an account that may
  // already have one is how another tenant's live line gets taken to fix a
  // problem that was only ever a failed read. Its own failure is swallowed to
  // an empty list — the number step still has its primary path (buy in
  // Telnyx, assign on the Voice page), so a broken cross-account read must not
  // take the whole wizard down with it.
  let movableNumbers: MovableNumber[] = [];
  if (assignedNumber === null) {
    try {
      const all = await listAllPhoneNumbers(db);
      movableNumbers = all
        .filter((n) => n.account_id !== accountId)
        .map((n) => ({
          id: n.id, e164: n.e164, status: n.status,
          accountName: n.account?.name ?? null,
        }));
    } catch (e) {
      console.error(`setup: cross-account number read failed for account ${accountId}: ${String(e)}`);
    }
  }

  return (
    <>
      <PageHeader
        title={m["setup.title"]}
        selector={
          accountName ? (
            <span className="text-sm text-muted-foreground">{accountName}</span>
          ) : undefined
        }
      />
      <div className="max-w-3xl space-y-4 p-6">
        {/* Same warning the checklist page shows, for the same reason and on
            the same param: createClientAccount now lands here, so a blueprint
            that only partly applied has to be visible on THIS page or it is
            visible nowhere. The checklist route keeps its own copy — it is
            still reachable directly. */}
        {apply === "partial" ? (
          <p
            role="alert"
            className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            {m["accounts.blueprintPartial"]}
          </p>
        ) : null}
        <SetupPanel
          accountId={accountId}
          steps={views}
          prereqsMet={prereqsMet}
          assignedNumber={assignedNumber}
          movableNumbers={movableNumbers}
          hasVoiceProfile={profile !== null}
          // accountId bound server-side on all three — it must never travel
          // as a form field. For moveNumberAction that binding is what makes
          // the account the DESTINATION rather than something the browser
          // gets to name.
          tickAction={setSetupTickAction.bind(null, accountId)}
          goLiveAction={goLiveAction.bind(null, accountId)}
          moveNumberAction={moveNumberAction.bind(null, accountId)}
          enableTestCallsAction={setNumberStatusAction.bind(null, accountId)}
        />
      </div>
    </>
  );
}
