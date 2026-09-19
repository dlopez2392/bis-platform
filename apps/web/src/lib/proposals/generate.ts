import { insertProposal, type CallOutcome, type TranscriptEvent, type serviceDb } from "@bis/db";
import { groundedEvidence } from "./grounding";
import { callIsEligible } from "./eligibility";
import { isValidEmail } from "@/lib/forms/guards";
import { toE164 } from "@/lib/voice/phone-number";

/**
 * At most three per call — a per-call BUDGET SHARED ACROSS KINDS, not three
 * tasks. The live partial unique index (`call_proposals_one_pending_unique`,
 * 0040_call_proposals.sql) is keyed on
 * `(call_id, kind, coalesce(contact_id, sentinel))`, and every proposal this
 * generator writes for one call shares that call's id AND that call's one
 * contact — so today, with only the `task` kind implemented, at most ONE
 * proposal can ever land per call: the second and third of anything sharing
 * that triple are refused by the database's own unique index, not stopped
 * by this constant. The budget becomes real once Tasks 8/9 add
 * `contact_field` and `opportunity_stage`: one of each kind can land per
 * call, up to this ceiling.
 *
 * Not a cost control — a noise control. A screen that offers eight
 * questions about one phone call is a screen a client stops reading, and
 * the spec's success criterion is that most calls propose NOTHING. A model
 * that wants to say eight things has not found three good ones.
 */
const MAX_PER_CALL = 3;

/**
 * A title lands verbatim on a review card, not a document. Defensive
 * against a model that runs on past a sentence — clamped, not rejected,
 * because a long-but-real title is still useful truncated, and a rejected
 * proposal here would be a silent drop of the caller's actual request.
 *
 * Shared with `contact_field`'s `value` for the identical reason (fix-wave
 * Minor): that value lands on the same review card `proposals.tsx`
 * interpolates straight into its sentence, so an unclamped 5,000-character
 * value is the same defect as an unclamped title, not a new one.
 */
const MAX_TITLE_LEN = 200;

const SYSTEM = [
  "You read a finished phone call and propose at most three concrete next steps.",
  "Propose nothing at all unless the caller stated something specific that needs doing.",
  "If the caller says they have the wrong number, or that this is not the business they meant to reach, propose NOTHING for that call, even if a message was taken for someone else.",
  "Every proposal MUST carry an `evidence` field quoting the CALLER's own words VERBATIM from the transcript.",
  "Never quote the assistant. Never paraphrase. If you cannot quote the caller, do not propose.",
  "Write every title in plain, everyday words a business owner would say out loud — never an internal code, an abbreviation, or `{{template}}` placeholder syntax.",
  '`dueAt` MUST be either a full ISO-8601 instant (for example "2026-09-23T09:00:00.000Z") or the literal JSON null value — never a phrase like "next Tuesday morning".',
  'Reply ONLY with JSON: {"proposals":[{"kind":"task","title":"...","dueAt":null,"evidence":"..."}]}',
  'If there is nothing to propose, reply {"proposals":[]}.',
].join(" ");

/**
 * The four contact columns a `contact_field` proposal may ever target. Never
 * a denylist, and never grown to include `custom`, tags or a consent flag —
 * consent in particular is a legal record, not a convenience this generator
 * gets to touch.
 */
const CONTACT_FIELDS = ["firstName", "lastName", "email", "phone"] as const;
type ContactField = (typeof CONTACT_FIELDS)[number];

/**
 * Builds the system prompt for one call, naming ONLY the fields this
 * particular contact currently has blank. The model is told which fields it
 * MAY propose, but it is never trusted to have checked that list itself —
 * `blankFields.includes(field)` below re-checks unconditionally, regardless
 * of what this sentence said or whether the model even read it.
 */
function systemFor(blankFields: readonly ContactField[]): string {
  if (blankFields.length === 0) return SYSTEM;
  return `${SYSTEM} You may also propose {"kind":"contact_field","field":"<one of: ${
    blankFields.join(", ")
  }>","value":"...","evidence":"..."} — but ONLY for those fields, and only when the caller stated the value out loud.`;
}

type RawProposal = {
  kind?: unknown; title?: unknown; dueAt?: unknown; evidence?: unknown;
  field?: unknown; value?: unknown;
};

function transcriptForModel(transcript: TranscriptEvent[]): string {
  return transcript.map((e) => `${e.role}: ${e.text}`).join("\n");
}

/**
 * Narrows one element of the model's `proposals` array. The array's
 * elements are NOT trusted to be objects: `JSON.stringify` turns
 * `[undefined]` into `[null]`, so a model that emits a trailing comma or an
 * empty slot produces exactly the same one-character shape as a deliberate
 * `null`, and this loop must survive both.
 */
function asRawProposal(v: unknown): RawProposal | null {
  return v && typeof v === "object" ? (v as RawProposal) : null;
}

/**
 * Generates and stores proposals for one finished call. Returns how many
 * were written.
 *
 * NEVER THROWS, and that is the contract the caller depends on: this runs
 * in the voice lifecycle's best-effort tail, after the call row is already
 * durable. A proposal failure must change nothing about the call, its
 * transcript, its outcome or its text-back. The eligibility check, the
 * fetch, the JSON parse AND the per-proposal loop all sit inside the SAME
 * try — a malformed element partway through must not throw past this
 * function, and a failure after some proposals already landed must not
 * report 0 and hide the ones that did. `callIsEligible` ends in
 * `eligibility.ts`'s `e.text.trim()`, and `TranscriptEvent.text` is typed
 * `string` only until something reads a transcript back through an
 * untyped boundary (a jsonb column cast with `as unknown as
 * CallDetailRow`) — that cast is exactly what a future caller does, so this
 * function cannot assume the type-checker already made the input safe.
 *
 * `accountId` and `callId` are independent parameters with no
 * composite-FK check tying `(account_id, call_id)` together (see
 * `insertProposal`'s own doc in `@bis/db`'s `call-proposals.ts`) — a caller
 * that mismatches them writes a real, RLS-visible row, carrying a verbatim
 * caller quote, to the wrong account.
 */
export async function generateProposals(input: {
  // Not `SupabaseClient` from `@supabase/supabase-js` directly: apps/web has
  // no dependency on that package (only `@bis/db` does), so importing the
  // name here fails `tsc` with "Cannot find module" even though it happens
  // to resolve at test/build time via pnpm's hoisting. `finish-call.ts` hits
  // the same boundary and solves it the same way: alias the type off the
  // one function whose declared return type IS `SupabaseClient`, without
  // ever naming the package.
  db: ReturnType<typeof serviceDb>; accountId: string; callId: string;
  contactId: string | null; outcome: CallOutcome;
  transcript: TranscriptEvent[]; handoffRequested: boolean;
  /**
   * Which of the four allow-listed contact columns are CURRENTLY EMPTY on
   * the resolved contact. Computed by the caller from the stored row — this
   * function cannot see it — and is the containment boundary for
   * `contact_field` proposals: a field absent from this list is refused
   * below regardless of what the model asked for. `[]` when there is no
   * resolved contact at all, or when the caller's own read of the contact
   * failed (fail-closed on the FIELD, never on the call).
   */
  blankFields: readonly ContactField[];
  fetchImpl?: typeof fetch;
}): Promise<number> {
  let written = 0;
  let attempts = 0;
  try {
    // ELIGIBILITY FIRST, and inside this same try, for two independent
    // reasons that both have to hold at once:
    //
    // 1. Ordering (Task 4 of the fix-wave): on the one live account, spam
    // and abandoned calls are the DOMINANT traffic — several robocalls a
    // day, every one ineligible. Checking `OPENAI_API_KEY` before this
    // check ran it, and its `console.error`, on every one of them; a
    // rotated or missing key would then log an error line per robocall,
    // and an alert that fires on the dominant path stops being read (this
    // branch has already applied that rule twice). Putting eligibility
    // first means an ineligible call costs no request, no key check and no
    // log line — the only thing distinguishing "ineligible" from "healthy
    // and quiet" is that neither logs anything at all.
    //
    // 2. Safety (fix-wave finding 2): `callIsEligible` ends in
    // `eligibility.ts`'s `e.text.trim()`, called on every transcript
    // element, and a hostile element (non-string `text`, a null element, a
    // null transcript) must not throw past this function's own "NEVER
    // THROWS" contract — so the check has to sit inside the try regardless
    // of where it sits relative to the key check.
    if (!callIsEligible({
      outcome: input.outcome, transcript: input.transcript,
      handoffRequested: input.handoffRequested,
    })) return 0;

    // Read inside the body, not at module scope: a missing key at build time
    // must never break the import (summary-service.ts:7-10's rule). Checked
    // AFTER eligibility (see above) so a rotated or missing key is only ever
    // logged for a call this function would otherwise have tried to propose
    // from.
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // A rotated or missing key silently disables this feature forever —
      // against a success criterion that MOST calls propose nothing, that
      // failure is indistinguishable from a healthy quiet call unless it logs.
      console.error(`generateProposals: OPENAI_API_KEY not set, skipping call ${input.callId}`);
      return 0;
    }
    const fetchImpl = input.fetchImpl ?? fetch;

    const r = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        // Deliberate divergence from summary-service.ts's own OpenAI call:
        // that function consumes PROSE and has a deterministic fact-line
        // fallback (`composeSummary`) when the completion is unusable, so a
        // stray code fence in the response costs it nothing. This function
        // parses JSON with no fallback of its own — an empty proposal list
        // IS the fallback — and `gpt-4o-mini` routinely wraps JSON in a
        // ```json fence when asked for JSON without `response_format`,
        // which would silently zero this feature forever. Forcing JSON mode
        // removes that failure instead of tolerating it.
        response_format: { type: "json_object" },
        // Minor 6 of the fix-wave: with no bound here, nothing states a
        // ceiling on how many elements the model's own `proposals` array
        // can contain before the loop below even starts counting attempts
        // — a flood of UNGROUNDED proposals still costs a full
        // `groundedEvidence` scan per element (measured: 5,000 elements
        // against a 120-turn transcript, 565ms). Three short task
        // proposals fit comfortably inside this; a runaway array does not.
        max_tokens: 2000,
        messages: [
          { role: "system", content: systemFor(input.blankFields) },
          { role: "user", content: transcriptForModel(input.transcript) },
        ],
      }),
      // Same 10s bound as the summary call. This runs after the row is
      // written so a hang cannot lose the call, but it still shares the
      // invocation's maxDuration budget.
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      console.error(`generateProposals: model request failed for call ${input.callId}: HTTP ${r.status}`);
      return 0;
    }
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      console.error(`generateProposals: model response had no content for call ${input.callId}`);
      return 0;
    }
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed?.proposals)) {
      console.error(`generateProposals: model response had no proposals array for call ${input.callId}`);
      return 0;
    }
    const raw: unknown[] = parsed.proposals;

    for (const item of raw) {
      // Capped on ATTEMPTS considered, not on successful writes: a model
      // returning many proposals that all collide with the same call's
      // unique-index triple (the normal case today — see MAX_PER_CALL's own
      // doc) must not turn into unbounded round trips and unbounded log
      // lines while `written` stays flat.
      if (attempts >= MAX_PER_CALL) break;
      const p = asRawProposal(item);
      if (!p) continue;
      // Shared by every kind below: both `task` and `contact_field` require
      // a verbatim caller quote, so it is read once here rather than
      // duplicated per branch.
      const evidence = typeof p.evidence === "string" ? p.evidence.trim() : "";

      if (p.kind === "contact_field") {
        // THE MODEL IS NOT TRUSTED TO CHECK — it cannot see the contact
        // row. `blankFields` is computed from the stored contact by the
        // caller (finish-call.ts), and a field absent from it is refused
        // here regardless of what the model asked for. This is the
        // propose-time half of the containment rule; the accept-time half
        // is `fillContactBlanks`, which re-reads the contact and then runs
        // an UNCONDITIONAL update — a fresh read shortly before the write,
        // not an atomic check-and-set, so a human who fills the same field
        // in the gap between this generator's read and a later accept click
        // still loses that race to whichever write lands last. ("Atomic"
        // overstated a guarantee this pair does not have; fix-wave finding.)
        const field = typeof p.field === "string" ? (p.field as ContactField) : null;
        // Clamped like `title` below (MAX_TITLE_LEN's own doc) — same review
        // card, same argument.
        const value = typeof p.value === "string" ? p.value.trim().slice(0, MAX_TITLE_LEN) : "";
        // ALLOW-LIST, never a denylist: `custom`, tags and consent flags
        // stay out of v1 by refusing anything not in CONTACT_FIELDS, not by
        // naming what to reject.
        if (!field || !CONTACT_FIELDS.includes(field)) continue;
        if (!input.blankFields.includes(field)) continue;
        if (!value || !input.contactId) continue;

        // FORMAT CHECK, fix-wave Important 2. Nothing downstream validates
        // what lands in `contacts.email`/`contacts.phone` — the live schema
        // has no CHECK on either column, and `fillContactBlanks` writes
        // whatever it is handed. The value here originates as a SPEECH
        // TRANSCRIPTION ("five five five, one two three four"), so a
        // non-E.164 phone is the likely output, not the corner case, and an
        // unnormalised `contacts.phone` breaks phone dedupe plus every
        // text-back/alert path that keys on it. Dropped exactly the way
        // `dueAt` below is rejected rather than stored as garbage a human's
        // accept click cannot fix — a proposal with an unparsable value is
        // worth nothing to a reviewer either way.
        let storedValue = value;
        if (field === "phone") {
          const normalizedPhone = toE164(value);
          if (!normalizedPhone) continue;
          storedValue = normalizedPhone;
        } else if (field === "email") {
          if (!isValidEmail(value)) continue;
        }

        const grounded = groundedEvidence(evidence, input.transcript);
        if (grounded === null) continue;
        // Same budget as `task` below: this counts as an ATTEMPT the moment
        // it reaches the database, win or lose (MAX_PER_CALL's own doc — the
        // cap is on attempts considered, shared across kinds, not per kind).
        attempts++;
        const created = await insertProposal(input.db, input.accountId, {
          callId: input.callId, contactId: input.contactId, kind: "contact_field",
          payload: { field, value: storedValue }, evidence: grounded,
        });
        if (created) written++;
        continue;
      }

      // ALLOW-LIST, never a denylist. v1 emits `task` and `contact_field`
      // only; `opportunity_stage` exists in the schema but has no generator
      // yet, and a model naming it (or anything else) must not smuggle it
      // past this loop.
      if (p.kind !== "task") continue;
      const title = typeof p.title === "string" ? p.title.trim().slice(0, MAX_TITLE_LEN) : "";
      if (!title) continue;
      // THE BOUNDARY, and note WHAT IS STORED. `groundedEvidence` returns the
      // caller's WHOLE TURN, not the model's excerpt of it, and that turn is
      // what the reviewer sees.
      //
      // The excerpt cannot be trusted to carry its own meaning: substring
      // matching cannot see a negation sitting outside the quote, so
      // "I don't need a quote for a dining table" yields the verbatim,
      // caller-role, within-one-turn span "need a quote for a dining table" —
      // which reads on the review screen as assent. 12.8% of this product's
      // real caller turns carry a negation, so this is the common case, not a
      // corner. Storing the turn also ends a second divergence: matching
      // normalises case and whitespace, so the model's excerpt could differ
      // from the transcript printed directly above it.
      const grounded = groundedEvidence(evidence, input.transcript);
      if (grounded === null) continue;
      // Reject, never store, free text: a `dueAt` that does not parse would
      // reach the accept path as garbage a task write cannot use. Stored as
      // null instead of dropping the whole proposal — the caller's request
      // is still real even when the model botched the timestamp format.
      //
      // Fix-wave finding 3: storing the RAW trimmed string (the old
      // behavior) let `Date.parse`-valid-but-not-a-real-instant values like
      // `"2026"` through — `tasks.due_at` is `timestamptz`, and Postgres
      // refuses that literal outright (`select '2026'::timestamptz` errors
      // live), so the proposal would fail at a human's accept click, after
      // the review screen already showed it as fine. A quieter second case:
      // a zone-less instant like `"2026-09-23T09:00"` means LOCAL time to
      // `Date.parse` and SERVER time to Postgres, silently reinterpreting
      // the instant at that same boundary. Parsing once and storing
      // `.toISOString()`'s own normalised instant instead of the model's
      // raw text kills both: it rejects nothing `Date.parse` already
      // accepted, and what lands in the row is a full instant in the exact
      // shape SYSTEM's own example tells the model to send.
      let dueAt: string | null = null;
      if (typeof p.dueAt === "string") {
        const trimmed = p.dueAt.trim();
        if (trimmed && !Number.isNaN(Date.parse(trimmed))) dueAt = new Date(trimmed).toISOString();
      }
      attempts++;
      const created = await insertProposal(input.db, input.accountId, {
        callId: input.callId, contactId: input.contactId, kind: "task",
        payload: { title, dueAt }, evidence: grounded,
      });
      if (created) written++;
    }
  } catch (e) {
    // Unparseable content, a network failure and a timeout are all the same
    // event here: no MORE proposals. But whatever already landed before the
    // failure is real and must be reported — returning 0 here would
    // under-count writes that already reached the database.
    console.error(`generateProposals: failed for call ${input.callId}: ${String(e)}`);
    return written;
  }
  return written;
}
