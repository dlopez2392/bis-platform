import { insertProposal, type CallOutcome, type TranscriptEvent, type serviceDb } from "@bis/db";
import { groundedEvidence } from "./grounding";
import { callIsEligible } from "./eligibility";

/**
 * At most three per call.
 *
 * Not a cost control — a noise control. A screen that offers eight
 * questions about one phone call is a screen a client stops reading, and
 * the spec's success criterion is that most calls propose NOTHING. A model
 * that wants to say eight things has not found three good ones.
 */
const MAX_PER_CALL = 3;

const SYSTEM = [
  "You read a finished phone call and propose at most three concrete next steps.",
  "Propose nothing at all unless the caller stated something specific that needs doing.",
  "If the caller says they have the wrong number, or that this is not the business they meant to reach, propose NOTHING for that call, even if a message was taken for someone else.",
  "Every proposal MUST carry an `evidence` field quoting the CALLER's own words VERBATIM from the transcript.",
  "Never quote the assistant. Never paraphrase. If you cannot quote the caller, do not propose.",
  'Reply ONLY with JSON: {"proposals":[{"kind":"task","title":"...","dueAt":null,"evidence":"..."}]}',
  'If there is nothing to propose, reply {"proposals":[]}.',
].join(" ");

type RawProposal = { kind?: unknown; title?: unknown; dueAt?: unknown; evidence?: unknown };

function transcriptForModel(transcript: TranscriptEvent[]): string {
  return transcript.map((e) => `${e.role}: ${e.text}`).join("\n");
}

/**
 * Generates and stores proposals for one finished call. Returns how many
 * were written.
 *
 * NEVER THROWS, and that is the contract the caller depends on: this runs
 * in the voice lifecycle's best-effort tail, after the call row is already
 * durable. A proposal failure must change nothing about the call, its
 * transcript, its outcome or its text-back.
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
  if (!apiKey) return 0;
  const fetchImpl = input.fetchImpl ?? fetch;

  let raw: RawProposal[] = [];
  try {
    const r = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
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
    if (!r.ok) return 0;
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return 0;
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed?.proposals)) return 0;
    raw = parsed.proposals as RawProposal[];
  } catch {
    // Unparseable content, a network failure and a timeout are all the
    // same event here: no proposals. Never a throw.
    return 0;
  }

  let written = 0;
  for (const p of raw) {
    if (written >= MAX_PER_CALL) break;
    // ALLOW-LIST, never a denylist. v1 emits `task` only; the other two
    // kinds exist in the schema but have no generator yet, and a model
    // naming one must not smuggle it past this loop.
    if (p.kind !== "task") continue;
    const title = typeof p.title === "string" ? p.title.trim() : "";
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
    const dueAt = typeof p.dueAt === "string" && p.dueAt.trim() ? p.dueAt : null;
    const created = await insertProposal(input.db, input.accountId, {
      callId: input.callId, contactId: input.contactId, kind: "task",
      payload: { title, dueAt }, evidence: grounded,
    });
    if (created) written++;
  }
  return written;
}
