// apps/web/src/lib/setup/setup-inputs.ts
import {
  getCalendarForAccount, getVoiceProfile, listPhoneNumbersForAccount,
  countCallsSince, listChecklistState, listForms, hasConciergeSiteConversation,
  serviceDb, type SupabaseClient, type PhoneNumberRow,
} from "@bis/db";
import { SETUP_TICK_KEYS, type SetupInputs } from "./setup-status";
import type { ReadKey } from "./setup-view";

export type GatheredSetupInputs = {
  /** Feeds `deriveSetupStatus` directly — a failed leg's field already holds
   *  its neutral default (see `failed` below for which). */
  inputs: SetupInputs;
  /** The FULL phone-number rows `listPhoneNumbersForAccount` returned — not
   *  `inputs.numbers`, which stays the narrower `Pick<PhoneNumberRow,
   *  "status">[]` `deriveSetupStatus` has always needed (see that field's
   *  own note below for why it isn't widened). A caller that needs `id`/
   *  `e164` too (goLiveAction picking which number to flip live;
   *  setup/page.tsx's own assignedNumber/movableNumbers) reads this field
   *  instead of `inputs.numbers` — no cast, no second read of the table. */
  numbers: PhoneNumberRow[];
  /** Per-leg failure, keyed the same as setup/page.tsx's own long-standing
   *  `ReadKey` (lib/setup/setup-view.ts) — `account` here means the
   *  `brand_name`/`from_email` lookup specifically, not the caller's own
   *  identity check. */
  failed: Record<ReadKey, boolean>;
};

/**
 * The eight reads `deriveSetupStatus` needs to answer all ten step
 * questions — the account's own `brand_name`/`from_email` plus seven
 * `@bis/db` reads (five original, plus the website-assistant step's own
 * `forms`/`conversations` pair). This exact read set used to live duplicated three times:
 * the sidebar's setup meter (formerly `setup-actions.ts`'s `getSetupProgress`,
 * now folded into `shell-actions.ts`'s `getShellSnapshot`), the setup
 * wizard's own render (`setup/page.tsx`), and `goLiveAction`'s prerequisite
 * re-check (`setup/actions.ts`). One copy here now.
 *
 * `Promise.allSettled`, not `Promise.all`: this is a straight relocation of
 * `setup/page.tsx`'s own original per-leg fault isolation — a failed read
 * degrades ONLY the field(s) it was going to answer, to that field's neutral
 * default (`null`/`[]`/`0`/`false`), never the other five. `failed` reports
 * exactly which leg(s) came back that way, so a caller that needs
 * per-field granularity (`setup/page.tsx`'s own "couldn't check" cards, via
 * `buildSetupViews`'s `READS_BEHIND` mapping) gets it back byte-for-byte,
 * and a caller that wants an atomic answer instead (`shell-actions.ts`'s
 * `getShellSnapshot`: `Object.values(failed).some(Boolean)`;
 * `goLiveAction`: every leg it actually reads, see below) can still fold
 * `failed` down to one boolean on its own terms. Tolerates a missing
 * account row (`maybeSingle()` returns `null`) rather than throwing "not
 * found" — this mirrors the sidebar meter's original behavior, not the
 * wizard page's own (which separately confirms the account exists for its
 * header display; see that file for why it keeps a second, tiny
 * `name`-only query alongside this call rather than folding that into
 * `SetupInputs`, which has no `name` field — it exists to feed
 * `deriveSetupStatus`, not to paint a header).
 *
 * `inputs.numbers`'s declared type stays the narrower `Pick<PhoneNumberRow,
 * "status">[]` `SetupInputs` has always carried (all `deriveSetupStatus`
 * needs, and the shape both `setup-status.test.ts` and `setup-view.test.ts`'s
 * own fixtures are pinned to — widening it to the full row would break both
 * suites' minimal `{ status: "live" }` fixtures, which is exactly the
 * "byte-identical, existing suites unchanged" line this task must not
 * cross). The FULL rows are always there at runtime regardless (this
 * function never strips them) — they are just exposed honestly through this
 * return value's sibling `numbers` field instead, for the two callers that
 * need `id`/`e164` too.
 *
 * `db` is passed in, not read from ambient state, so each of the three
 * callers keeps its own already-settled choice of client: the wizard page
 * runs as the signed-in agency user (`dbForRequest()`, so a grants problem
 * shows up as a broken card, unchanged by this move), the sidebar meter and
 * goLiveAction's re-check both already ran on `serviceDb()`.
 */
export async function gatherSetupInputs(
  db: SupabaseClient, accountId: string,
): Promise<GatheredSetupInputs> {
  // Hoisted OUT of the array literal below (fix-round review, MINOR 10):
  // `serviceDb()` throws synchronously (a missing service-role env var), and
  // a synchronous throw while BUILDING the array `Promise.allSettled` takes
  // happens before `allSettled` ever gets to wrap anything — it would escape
  // as a rejected `gatherSetupInputs` promise, which page.tsx's own doc
  // comment (and every other caller's) relies on this function never doing.
  const privileged = serviceDb();
  const settled = await Promise.allSettled([
    db.from("accounts").select("brand_name, from_email").eq("id", accountId).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`gatherSetupInputs: account lookup failed: ${error.message}`);
        return data as { brand_name: string | null; from_email: string | null } | null;
      }),
    getCalendarForAccount(db, accountId),
    getVoiceProfile(db, accountId),
    listPhoneNumbersForAccount(db, accountId),
    // Epoch floor: "has this account EVER taken a call" — the same
    // question the test-call step asks on the setup page itself.
    countCallsSince(db, accountId, "1970-01-01T00:00:00.000Z"),
    listChecklistState(db, accountId),
    // The website-assistant step's own two legs (Setup step task): published
    // forms (row 2) and site conversations (row 4's proof). Own legs, not
    // folded into the profile read above, so a failure in either degrades
    // ONLY website_assistant (READS_BEHIND in setup-view.ts) — never
    // voice_profile, which never touches forms or conversations.
    listForms(db, accountId),
    // `serviceDb()`, NOT the caller's own `db` — found by the e2e run
    // (setup.spec.ts), which reads this page as the signed-in agency user
    // on purpose so a grants problem shows up as a broken step (see this
    // file's own doc comment, and page.tsx's). `concierge_conversations` is
    // service_role only BY DESIGN (0042_web_concierge.sql's own grant
    // block: "Nothing but the concierge route reads or writes this, and the
    // route uses serviceDb() … service_role only, no `authenticated` grant
    // at all") — `authenticated` (what `dbForRequest()` runs as) can never
    // read it, on the wizard page or anywhere else, so this ONE leg uses
    // `serviceDb()` unconditionally regardless of which client the caller
    // passed in for the other seven. This is not a workaround: it is the
    // exact shape every other `concierge.ts` consumer already uses
    // (voice/page.tsx's own doc comment: "Both reads below go through
    // serviceDb(), matching the writes"), and it must NOT be "fixed" by
    // widening the table's grant to `authenticated` — that reopens the
    // exact leak 0042 closed.
    hasConciergeSiteConversation(privileged, accountId),
  ]);
  const [accountR, calendarR, profileR, numbersR, callsR, ticksR, formsR, conversationsR] = settled;

  // Otherwise a failing read is visible only as a warning chip on screen (or
  // a silently degraded section, for the two callers that fold `failed` to
  // one boolean), with nothing anywhere saying what actually broke.
  for (const result of settled) {
    if (result.status === "rejected") {
      console.error(`gatherSetupInputs: read failed for account ${accountId}: ${String(result.reason)}`);
    }
  }

  const failed: Record<ReadKey, boolean> = {
    account: accountR.status === "rejected",
    calendar: calendarR.status === "rejected",
    profile: profileR.status === "rejected",
    numbers: numbersR.status === "rejected",
    calls: callsR.status === "rejected",
    ticks: ticksR.status === "rejected",
    forms: formsR.status === "rejected",
    conversations: conversationsR.status === "rejected",
  };

  const account = accountR.status === "fulfilled" ? accountR.value : null;
  const numbers = numbersR.status === "fulfilled" ? numbersR.value : [];
  const checklistRows = ticksR.status === "fulfilled" ? ticksR.value : [];
  // Narrowed to PUBLISHED, same as the Voice page's own website-assistant
  // card (voice/page.tsx) — a draft form has no `/f/<publicId>` a lead could
  // land on, so it is not "ready" for row 2's purposes.
  const publishedFormCount = formsR.status === "fulfilled"
    ? formsR.value.filter((f) => f.status === "published").length
    : 0;

  const ticked = (key: string) =>
    checklistRows.some((row) => row.item_key === key && row.done_at !== null);

  const inputs: SetupInputs = {
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
    publishedFormCount,
    conciergeSiteConversation: conversationsR.status === "fulfilled" ? conversationsR.value : false,
  };

  return { inputs, numbers, failed };
}
