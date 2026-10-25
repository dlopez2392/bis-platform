// S-47e (E7, spec 5.10.0, S19-S21; plan P26, P27): which contact a voice write lands on, on the number it would
// store. The SAME name and email rules as the confirm (match.ts). Never fuzzy; never a contact the caller did not
// name, confirm or say was them. Pure.
import type { CallState } from "../call-state";
import { nameWords, nameMatch, nameHits, spokenEmailKey, type Candidate } from "./match";
import { withLeadWhoseAsked } from "./state";
import { LEAD_ASK_WHOSE, type ToolResult } from "./results";

export type RecordPick =
  | { kind: "today" } | { kind: "existing"; contactId: string } | { kind: "create" }
  | { kind: "ask_name" } | { kind: "ask_whose" } | { kind: "ambiguous" };

/** A "Caller" placeholder, or a record with no name at all: today's path fills its blanks (decision 19). */
function isPlaceholder(words: readonly string[]): boolean {
  return words.length === 0 || (words.length === 1 && words[0] === "caller");
}

/** A name agrees with the ONE contact on a number when P26's rule matches, or when either side is a first name
 *  alone and the first words are equal ("Ana" for "Ana Prueba", "Dan Lopez" for a record of "Dan"). */
function agreesWithSole(spoken: readonly string[], words: readonly string[]): boolean {
  if (spoken.length === 0 || spoken[0] !== words[0]) return false;
  return spoken.length === 1 || words.length === 1 || nameMatch(spoken, words) !== null;
}

export function pickRecordOnNumber(input: {
  /** realCandidates of the number being stored (holding records already out). */
  onNumber: readonly Candidate[];
  truncated: boolean;
  name: string | null | undefined;
  email: string | null | undefined;
  /** state.identity.confirmed?.contactId, ONLY when the number being stored is the caller ID; else null. */
  confirmedId: string | null;
  /** The caller's own answer to "Is this for you or for someone else?" (plan P27); undefined when not asked. */
  forSomeoneElse?: boolean;
}): RecordPick {
  const { onNumber, truncated } = input;
  const spoken = nameWords(input.name);
  if (!truncated && onNumber.length === 0) return { kind: "today" };
  if (!truncated && onNumber.length === 1) {
    const sole = onNumber[0]!;
    if (input.forSomeoneElse === true) return { kind: "create" };
    if (input.forSomeoneElse === false) return { kind: "existing", contactId: sole.id };
    if (isPlaceholder(sole.words) || spoken.length === 0 || agreesWithSole(spoken, sole.words)) return { kind: "today" };
    return { kind: "ask_whose" };
  }
  if (truncated) return { kind: "ambiguous" };
  const c = input.confirmedId === null ? undefined : onNumber.find((x) => x.id === input.confirmedId);
  if (c && (input.forSomeoneElse === false || spoken.length === 0 || nameMatch(spoken, c.words) !== null
    || (spoken.length === 1 && spoken[0] === c.words[0]))) {
    return { kind: "existing", contactId: c.id };
  }
  if (spoken.length < 2) return { kind: "ask_name" };
  const byName = nameHits(spoken, onNumber);
  if (byName.length === 1) return { kind: "existing", contactId: byName[0]!.id };
  if (byName.length > 1) {
    const key = input.email == null ? null : spokenEmailKey(input.email);
    const picked = key === null ? [] : byName.filter((x) => x.emailKey === key);
    return picked.length === 1 ? { kind: "existing", contactId: picked[0]!.id } : { kind: "ambiguous" };
  }
  return { kind: "create" };
}

/** capture_lead asks "for you or for someone else?" once per call, and only when the lead has a name and a number
 *  and the caller has not already answered (plan P27). */
export function leadNeedsWhoseCheck(state: CallState, fullName: string | undefined, forSomeoneElse: boolean | undefined): boolean {
  return !state.identity.leadWhoseAsked && forSomeoneElse === undefined && nameWords(fullName).length > 0;
}

/** The ask, or null to record the lead (a failed read records it: a lead is never lost on our outage). */
export function leadWhoseStep(
  state: CallState, read: { ok: true; candidates: readonly Candidate[]; truncated: boolean } | { ok: false }, fullName: string | undefined,
): { state: CallState; result: ToolResult } | null {
  if (!read.ok) return null;
  const pick = pickRecordOnNumber({ onNumber: read.candidates, truncated: read.truncated, name: fullName, email: null, confirmedId: null });
  return pick.kind === "ask_whose" ? { state: withLeadWhoseAsked(state), result: LEAD_ASK_WHOSE } : null;
}
