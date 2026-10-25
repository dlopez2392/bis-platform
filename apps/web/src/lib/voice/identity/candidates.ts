// S-47e (spec 5.2, S1): who is really on a number: listContactsOnNumber's rows, holding records out, filtered by
// the rule the ownership check has always used (isCallerIdNumber). One indexed read per call of readCandidates.
import { listContactsOnNumber, type NumberContactRow } from "@bis/db";
import type { serviceDb } from "@bis/db";
import { isCallerIdNumber } from "../phone-number";
import { candidateOf, type Candidate } from "./match";

type VoiceDb = ReturnType<typeof serviceDb>;
export type CandidateList = { candidates: Candidate[]; truncated: boolean };

export function realCandidates(rows: readonly NumberContactRow[], e164: string): Candidate[] {
  return rows.filter((r) => !r.holds_shared_number && isCallerIdNumber(r.phone, e164)).map(candidateOf);
}
/** Two or more real contacts, or more than the limit (spec S20). */
export function isShared(list: { candidates: readonly Candidate[]; truncated: boolean }): boolean {
  return list.truncated || list.candidates.length >= 2;
}
/** Throws on a read error. */
export async function readCandidates(db: VoiceDb, accountId: string, e164: string): Promise<CandidateList> {
  const { rows, truncated } = await listContactsOnNumber(db, accountId, e164);
  return { candidates: realCandidates(rows, e164), truncated };
}
