import type { Proposal } from "@bis/db/proposal-rules";
import type { Db } from "./kinds/types";
import type { SuggestionViewCtx } from "./view";
import { loggableError } from "@/lib/loggable-error";

/**
 * The stage names a screen's suggestions need (item 8b-1, plan fix I-5), shared by the call page and the
 * To do tray: the deals behind the stage suggestions (their `pipeline_id`), then the WHOLE stage list of
 * those pipelines, for `describe`'s names and positions and Edit's choices. Both reads run on the request
 * client the page passes in, carry the account's own filter (RLS does not backstop them: an agency
 * session reads every tenant's rows) and are bounded. A failed read throws: the caller puts its section
 * into the error state, never a card it cannot name.
 */
export type StageContext = Pick<SuggestionViewCtx, "stages" | "pipelineStages">;

const NONE: StageContext = { stages: {}, pipelineStages: [] };

export async function readSuggestionStages(db: Db, accountId: string, rows: readonly Proposal[]): Promise<StageContext> {
  const dealIds = [...new Set(rows.flatMap((r) => (r.kind === "opportunity_stage" ? [r.payload.opportunityId] : [])))];
  if (dealIds.length === 0) return NONE;

  const deals = await db.from("opportunities").select("id, pipeline_id")
    .eq("account_id", accountId).in("id", dealIds).limit(dealIds.length);
  if (deals.error) throw new Error(`suggestion deals read failed: ${deals.error.message}`);
  const pipelineIds = [...new Set(((deals.data ?? []) as { pipeline_id: string }[]).map((d) => d.pipeline_id))];
  if (pipelineIds.length === 0) return NONE;

  const read = await db.from("pipeline_stages").select("id, name, position, pipeline_id")
    .eq("account_id", accountId).in("pipeline_id", pipelineIds).limit(500);
  if (read.error) throw new Error(`suggestion stages read failed: ${read.error.message}`);
  const rowsRead = (read.data ?? []) as { id: string; name: string; position: number; pipeline_id: string }[];

  const stages: Record<string, { name: string; position: number }> = {};
  for (const s of rowsRead) stages[s.id] = { name: s.name, position: s.position };
  return {
    stages,
    pipelineStages: rowsRead.map((s) => ({ id: s.id, name: s.name, position: s.position, pipelineId: s.pipeline_id })),
  };
}

export type AgencySuggestionContext = {
  /** Only the accounts that have a stage suggestion; any other account's cards need no stage. */
  stagesByAccount: ReadonlyMap<string, StageContext>;
  /** Every account present, its own persona, else "Sofía" (plan ambiguity 10: never the agency's own). */
  personaByAccount: ReadonlyMap<string, string>;
  callsById: ReadonlyMap<string, { startedAt: string | null; contactId: string | null }>;
};

const PERSONA_FALLBACK = "Sofía";

type PersonaRow = { account_id: string; persona_name: string | null };

/** Soft: a failed read is no names, so every account's cards read "Sofía". */
async function readPersonas(db: Db, accountIds: readonly string[]): Promise<PersonaRow[]> {
  if (accountIds.length === 0) return [];
  try {
    const { data, error } = await db.from("voice_profiles").select("account_id, persona_name")
      .in("account_id", accountIds).limit(accountIds.length);
    if (error) throw new Error(`suggestion personas read failed: ${error.message}`);
    return (data ?? []) as PersonaRow[];
  } catch (e) {
    console.error(`work queue: suggestion personas read failed, marking every account's suggestions as ${PERSONA_FALLBACK}: ${loggableError(e)}`);
    return [];
  }
}

/**
 * The agency Work page's context for its cards (item 8b-2, spec 5.2), on the SERVICE client the page
 * already reads every tenant with. Bounded: one `readSuggestionStages` per account that HAS a stage
 * suggestion, each scoped to that account and given only that account's rows; ONE persona read for every
 * account (`voice_profiles.account_id` is unique, 0019, so one row per account); ONE calls read.
 *
 * The calls read cannot carry an account filter (it serves every account at once), so the account check
 * stands in for one: a call is kept only when the read answers it under the account of a row that cites
 * it. 0088's composite FK on `(account_id, call_id)` makes a mismatch unreachable today.
 *
 * THROWS on a failed stage or calls read: the section's error state. The persona read alone is soft
 * ("Sofía" for every account, logged), as on the To do and call pages.
 */
export async function readAgencySuggestionContext(db: Db, rows: readonly Proposal[]): Promise<AgencySuggestionContext> {
  const byAccount = new Map<string, Proposal[]>();
  for (const r of rows) byAccount.set(r.accountId, [...(byAccount.get(r.accountId) ?? []), r]);
  const accountIds = [...byAccount.keys()];
  const citedBy = new Map<string, Set<string>>();
  for (const r of rows) if (r.callId) citedBy.set(r.callId, (citedBy.get(r.callId) ?? new Set()).add(r.accountId));
  const callIds = [...citedBy.keys()];
  const withStages = accountIds.filter((a) => byAccount.get(a)!.some((r) => r.kind === "opportunity_stage"));

  const [stages, personas, calls] = await Promise.all([
    Promise.all(withStages.map(async (a) => [a, await readSuggestionStages(db, a, byAccount.get(a)!)] as const)),
    readPersonas(db, accountIds),
    callIds.length === 0 ? Promise.resolve([]) : db.from("calls").select("id, account_id, started_at, contact_id")
      .in("id", callIds).limit(callIds.length)
      .then(({ data, error }) => {
        if (error) throw new Error(`suggestion calls read failed: ${error.message}`);
        return (data ?? []) as { id: string; account_id: string; started_at: string | null; contact_id: string | null }[];
      }),
  ]);

  const named = new Map(personas.map((p) => [p.account_id, p.persona_name?.trim() ?? ""]));
  const personaByAccount = new Map(accountIds.map((a) => [a, named.get(a) || PERSONA_FALLBACK]));
  const callsById = new Map<string, { startedAt: string | null; contactId: string | null }>();
  for (const c of calls) {
    if (citedBy.get(c.id)?.has(c.account_id)) callsById.set(c.id, { startedAt: c.started_at, contactId: c.contact_id });
  }
  return { stagesByAccount: new Map(stages), personaByAccount, callsById };
}
