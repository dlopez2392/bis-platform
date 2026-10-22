import type { SupabaseClient } from "@bis/db";
import type { CallState } from "./call-state";
import { classifyOutcome } from "./call-state";
import { buildSummaryInput, composeSummary } from "./summarize";
import { aiComplete } from "@/lib/ai/gateway";
import { ID_RULE, maskIdNumbers } from "./id-mask";

/**
 * Generates the staff-facing call summary. The caller holds `CallState` — this
 * function does not load or save anything. The completion goes through the one
 * AI door (`lib/ai/gateway.ts`, item 8a-1): the account's switch, the global
 * switch and the monthly budget are checked there, the ledger row is written
 * there, and ANY refusal or failure — no key, switched off, over budget, a
 * timeout, a refused request — comes back as `ok: false`, and the fact line
 * stands alone via `composeSummary("", state)`, exactly as a missing key did
 * before the gateway.
 *
 * `spam` — and ONLY `spam` — skips the model entirely, BEFORE the gateway, so a
 * robocall costs no gate read, no ledger row and no log line. `classifyOutcome`
 * returns it exactly when there is no booking, no lead, no message AND no
 * caller transcript event carrying text (call-state.ts), so the request would
 * hand the model `TRANSCRIPT:\n(no speech captured)` and ask for 3-4 sentences
 * about it. That is not a hypothetical: of the nine spam calls on file, the
 * five real ones (zero caller events each) all bought a completion, and one of
 * them came back asserting "the caller asked to review availability for
 * Wednesday, September 4" from an empty transcript — invented, and it tripped
 * `composeSummary`'s own ⚠ MISMATCH warning on the call detail page. So the
 * skip buys two things, not one: the token cost, and a fabricated alarm.
 *
 * `abandoned` deliberately still calls the model. The classifier only reaches
 * it when a caller DID speak (transcript, production average 5 events), it is
 * the outcome the missed-call text-back fires on, and its stored summary is
 * the only account anywhere of why a real human rang and left.
 *
 * The column is never left blank: `composeSummary("", state)` is the same
 * deterministic fact line every refusal produces, so the call detail page, the
 * ⌘K `summary.ilike` search and the work queue's conversation title all read
 * exactly what they read before, minus the prose.
 */
export async function generateSummary(
  state: CallState,
  opts: {
    db: SupabaseClient; accountId: string; timezone?: string; ref?: string; fetchImpl?: typeof fetch;
    /** S-47b, owner ruling B7 (insurance accounts): the WHOLE input is masked, because INTAKE echoes tool
     *  arguments the model wrote, and the rule is the system's last sentence. Absent = today's request. */
    protectIds?: boolean;
  },
): Promise<string> {
  if (classifyOutcome(state) === "spam") return composeSummary("", state);

  const systemRules = [
    "Summarize this front-desk call for staff in 3-4 sentences.",
    "The BOOKED and INTAKE sections are the system's own records and are authoritative.",
    "Only state that an appointment was booked if BOOKED lists one; if BOOKED is (none), say plainly that no appointment was recorded.",
    "Only state that contact details were captured if INTAKE lists them; if INTAKE is (none), say plainly that none were captured.",
    "If the caller asked for something the records do not show, say what they asked for and that it was not completed — do not describe it as done.",
    "Never invent names, phone numbers, email addresses or times that do not appear in the input.",
    // English for every account, Spanish ones included (owner decision
    // A, 2026-10-10): summarize.ts's BOOKING_CLAIM/INTAKE_CLAIM mismatch
    // guards are English regexes and only hold over English prose. The
    // quote clause keeps a caller's own words untranslated.
    "Always write the summary in English (it is staff-facing), regardless of the language spoken on the call. If you quote the caller, keep the quote in the language the caller spoke.",
  ];
  // BOOKED times in the input are raw UTC (see summarize.ts's fact line,
  // which stays that way deliberately). Left alone, the prose model
  // renders that UTC instant as if it were already local — a booking at
  // 14:00 UTC became "2:00 PM" in a production summary when the account's
  // actual local time was 9:00 AM Central. Only added when a timezone is
  // known; with none, there is nothing correct to convert to.
  if (opts.timezone) {
    systemRules.push(
      `State all dates and times in the ${opts.timezone} timezone in natural local form (e.g. 9:00 AM Central). Never present a UTC time as if it were local.`,
    );
  }
  // After the timezone rule (re-review R4), so it is always the last sentence.
  if (opts.protectIds) systemRules.push(ID_RULE);
  const input = buildSummaryInput(state);
  const answer = await aiComplete(opts.db, {
    accountId: opts.accountId,
    feature: "call_summary",
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemRules.join(" ") },
      { role: "user", content: opts.protectIds ? maskIdNumbers(input) : input },
    ],
    // A hung connection would otherwise stall `finishCall` until Vercel kills
    // the invocation; 10s is generous for a 3-4 sentence completion. The
    // gateway turns the timeout into `ok: false`, and the fact line stands.
    timeoutMs: 10_000,
    // No zone → safeZone's fallback inside the gateway; the budget's month only.
    timezone: opts.timezone ?? "",
    ref: opts.ref,
    fetchImpl: opts.fetchImpl,
  });

  // The returned summary leads with what the system actually recorded, and
  // flags the prose when it disagrees. A model that claims a booking nobody
  // made is the failure this guards, and it reached production three times.
  return composeSummary(answer.ok ? answer.text : "", state);
}
