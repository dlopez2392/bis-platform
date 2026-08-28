import {
  getCalendarForAccount, getVoiceProfile, listPhoneNumbersForAccount,
  listChecklistState, countCallsSince,
} from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import {
  deriveSetupStatus, goLivePrereqsMet, SETUP_TICK_KEYS,
  type SetupStepKey,
} from "@/lib/setup/setup-status";
import { m } from "@/lib/messages";
import { SetupPanel, GO_LIVE_PREREQ_KEYS, type SetupStepView } from "./setup-panel";
import { setSetupTickAction } from "./actions";

export const dynamic = "force-dynamic";

type AccountRow = { name: string; brand_name: string | null; from_email: string | null };

/** Which read each step's answer depends on. A step whose read did not settle
 *  renders "couldn't check" — never "done", and never "to do" either, since a
 *  read that threw answered neither question. */
const READS_BEHIND: Record<SetupStepKey, readonly ReadKey[]> = {
  account: [],
  branding: ["account"],
  hours: ["calendar"],
  voice_profile: ["profile"],
  number: ["numbers"],
  // Both: `from_email` decides done, the stored tick decides skipped.
  email: ["account", "ticks"],
  forwarding: ["ticks"],
  test_call: ["calls"],
  // Mirrors the derive function: profile.enabled AND a number at status live.
  go_live: ["profile", "numbers"],
};

type ReadKey = "account" | "calendar" | "profile" | "numbers" | "ticks" | "calls";

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
 *    and never as not-done. Hence `Promise.allSettled` rather than
 *    `Promise.all`: one unlucky query must not take the page down, and it
 *    must not be allowed to quietly answer for the step it was going to
 *    verify. Rejections feed the derive function neutral inputs (so it only
 *    ever sees clean values) and are separately mapped, via READS_BEHIND, to
 *    an `unknown` flag the panel renders in its own distinct state.
 *
 * All six reads go through `dbForRequest()` — the page runs as the signed-in
 * agency user, on purpose. `serviceDb()` would render identically for an
 * account whose grants are wrong, which is exactly the failure this page
 * exists to catch: the setup wizard should see what its operator sees.
 * `getCalendarForAccount`, not `getOrCreateCalendar` — looking at a setup
 * page must not CREATE a calendar row as a side effect.
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

  const settled = await Promise.allSettled([
    db.from("accounts").select("name, brand_name, from_email").eq("id", accountId).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`setup: account lookup failed: ${error.message}`);
        if (!data) throw new Error("setup: account not found");
        return data as AccountRow;
      }),
    getCalendarForAccount(db, accountId),
    getVoiceProfile(db, accountId),
    listPhoneNumbersForAccount(db, accountId),
    listChecklistState(db, accountId),
    // Epoch floor: "has this account EVER taken a call", not "today", which
    // is what the test-call step is asking.
    countCallsSince(db, accountId, "1970-01-01T00:00:00.000Z"),
  ]);
  const [accountR, calendarR, profileR, numbersR, ticksR, callsR] = settled;

  // Otherwise a failing read is visible only as a warning chip on screen,
  // with nothing anywhere saying what actually broke.
  for (const result of settled) {
    if (result.status === "rejected") {
      console.error(`setup: read failed for account ${accountId}: ${String(result.reason)}`);
    }
  }

  const failed: Record<ReadKey, boolean> = {
    account: accountR.status === "rejected",
    calendar: calendarR.status === "rejected",
    profile: profileR.status === "rejected",
    numbers: numbersR.status === "rejected",
    ticks: ticksR.status === "rejected",
    calls: callsR.status === "rejected",
  };

  const account = accountR.status === "fulfilled" ? accountR.value : null;
  const numbers = numbersR.status === "fulfilled" ? numbersR.value : [];
  const checklistRows = ticksR.status === "fulfilled" ? ticksR.value : [];

  // `done_at` non-null is the tick. Keys the checklist catalogue does not
  // know about never render on the checklist page (mergeChecklist walks the
  // catalogue, not the rows), so these two live here without leaking into
  // that surface.
  const ticked = (key: string) =>
    checklistRows.some((row) => row.item_key === key && row.done_at !== null);

  const steps = deriveSetupStatus({
    brandName: account?.brand_name ?? null,
    fromEmail: account?.from_email ?? null,
    calendar: calendarR.status === "fulfilled" ? calendarR.value : null,
    profile: profileR.status === "fulfilled" ? profileR.value : null,
    numbers,
    callCount: callsR.status === "fulfilled" ? callsR.value : 0,
    ticks: {
      emailSkipped: ticked(SETUP_TICK_KEYS.emailSkipped),
      forwardingDone: ticked(SETUP_TICK_KEYS.forwardingDone),
    },
  });

  const views: SetupStepView[] = steps.map((step) => ({
    ...step,
    unknown: READS_BEHIND[step.key].some((read) => failed[read]),
  }));

  // An unverifiable prerequisite is not a met one. `goLivePrereqsMet` is the
  // authority on WHICH steps gate going live; this narrows its answer with
  // the one thing a pure function over derived rows cannot know — that some
  // of those rows never arrived.
  const prereqsMet =
    goLivePrereqsMet(steps) &&
    !views.some((v) => GO_LIVE_PREREQ_KEYS.includes(v.key) && v.unknown);

  // What the client's carrier forwards to, and what a test call dials. A
  // released number is a former number — forwarding a live business line to
  // one is how a client's calls go nowhere.
  const assignedNumber = numbers.find((n) => n.status !== "released")?.e164 ?? null;

  return (
    <>
      <PageHeader
        title={m["setup.title"]}
        selector={
          account ? (
            <span className="text-sm text-muted-foreground">{account.name}</span>
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
          // accountId bound server-side — it must never travel as a form field.
          tickAction={setSetupTickAction.bind(null, accountId)}
        />
      </div>
    </>
  );
}
