import { insertProposal, type CallOutcome, type TranscriptEvent, type serviceDb } from "@bis/db";
import { groundedEvidence } from "./grounding";
import { callIsEligible } from "./eligibility";

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

type RawProposal = { kind?: unknown; title?: unknown; dueAt?: unknown; evidence?: unknown };

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
 * transcript, its outcome or its text-back. The fetch, the JSON parse AND
 * the per-proposal loop all sit inside the SAME try — a malformed element
 * partway through must not throw past this function, and a failure after
 * some proposals already landed must not report 0 and hide the ones that
 * did.
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
  fetchImpl?: typeof fetch;
}): Promise<number> {
  // BEFORE the model call, never after. An ineligible call must not cost a
  // request — and asserting that the model was not called is the only way
  // a test can tell "skipped" from "called and returned nothing".
  if (!callIsEligible({
    outcome: input.outcome, transcript: input.transcript,
    handoffRequested: input.handoffRequested,
  })) return 0;

  // Read inside the body, not at module scope: a missing key at build time
  // must never break the import (summary-service.ts:7-10's rule).
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // A rotated or missing key silently disables this feature forever —
    // against a success criterion that MOST calls propose nothing, that
    // failure is indistinguishable from a healthy quiet call unless it logs.
    console.error(`generateProposals: OPENAI_API_KEY not set, skipping call ${input.callId}`);
    return 0;
  }
  const fetchImpl = input.fetchImpl ?? fetch;

  let written = 0;
  let attempts = 0;
  try {
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
        messages: [
          { role: "system", content: SYSTEM },
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
      // ALLOW-LIST, never a denylist. v1 emits `task` only; the other two
      // kinds exist in the schema but have no generator yet, and a model
      // naming one must not smuggle it past this loop.
      if (p.kind !== "task") continue;
      const title = typeof p.title === "string" ? p.title.trim().slice(0, MAX_TITLE_LEN) : "";
      const evidence = typeof p.evidence === "string" ? p.evidence.trim() : "";
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
      let dueAt: string | null = null;
      if (typeof p.dueAt === "string") {
        const trimmed = p.dueAt.trim();
        if (trimmed && !Number.isNaN(Date.parse(trimmed))) dueAt = trimmed;
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
