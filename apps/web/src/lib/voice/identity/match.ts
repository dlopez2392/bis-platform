// S-47e (spec 5.3; plan P26, P28): the name and email rules and the decision. The code compares; the model is
// told only the outcome (spec E2). Never fuzzy. Pure.
import { emailKey } from "@bis/db";
import { isValidEmail } from "../../forms/guards";

export type Candidate = { id: string; words: readonly string[]; emailKey: string | null };
export type Decision =
  | { kind: "none" }
  | { kind: "confirmed"; contactId: string; rung: 1 | 2; by: "caller_id" | "name" | "name_email" }
  | { kind: "ask_name" } | { kind: "ask_email" } | { kind: "miss" } | { kind: "cannot_on_this_call" };

const PARTICLES: ReadonlySet<string> = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "di", "van", "von"]);

/** NFKD with combining marks removed, lowercased, apostrophes removed, every other non-letter a space. */
export function nameWords(text: string | null | undefined): string[] {
  return String(text ?? "")
    .normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}]+/gu, " ")
    .trim().split(" ").filter((w) => w.length > 0);
}

/** Every word of `a` appears in `b`, in the same order (words of `b` may be skipped). */
function inOrder(a: readonly string[], b: readonly string[]): boolean {
  let i = 0;
  for (const w of b) {
    if (w === a[i]) i += 1;
    if (i === a.length) return true;
  }
  return a.length === 0;
}

/**
 * How a spoken name relates to one record's (plan P26, the orchestrator's ruling on R2):
 * - "exact": the same words, in the same order;
 * - "partial": the first words are equal, and EITHER every spoken word is on record in order and the spoken
 *   name does not end on a particle (spec 5.3 rules 3 and 4: "María García" for "María Elena García López"), OR
 *   every word of the record's name was spoken, in order ("María García López" for "María García");
 * - null otherwise. Both names need two words or more (rule 1): a first name alone, or a "Caller" placeholder,
 *   is never confirmed by name.
 */
export function nameMatch(spoken: readonly string[], record: readonly string[]): "exact" | "partial" | null {
  if (spoken.length < 2 || record.length < 2) return null;
  if (spoken[0] !== record[0]) return null;
  if (spoken.length === record.length && spoken.every((w, i) => w === record[i])) return "exact";
  const shorter = !PARTICLES.has(spoken[spoken.length - 1]!) && inOrder(spoken, record);
  return shorter || inOrder(record, spoken) ? "partial" : null;
}

export function nameMatches(spoken: readonly string[], record: readonly string[]): boolean {
  return nameMatch(spoken, record) !== null;
}

/** The candidates a spoken name names: the exact matches when there are any, else the partial ones. */
export function nameHits<T extends Candidate>(spoken: readonly string[], candidates: readonly T[]): T[] {
  const exact = candidates.filter((c) => nameMatch(spoken, c.words) === "exact");
  return exact.length > 0 ? exact : candidates.filter((c) => nameMatch(spoken, c.words) === "partial");
}

/** Whole words only, and only in an address said with no "@" (plan P28). */
const EMAIL_WORDS: Readonly<Record<string, string>> = {
  at: "@", arroba: "@", dot: ".", punto: ".", underscore: "_", dash: "-", hyphen: "-", guion: "-", raya: "-",
  plus: "+", mas: "+",
};
/** Two-word forms, read before the one-word ones ("guion bajo" before "guion"). */
const EMAIL_PAIRS: Readonly<Record<string, string>> = { "guion bajo": "_", "guion medio": "-" };

/** The spoken address as an email, or null when it does not have an email's shape (spec S3). */
export function spokenEmail(text: string | null | undefined): string | null {
  const s = String(text ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  let out: string;
  if (s.includes("@")) {
    out = s.replace(/\s+/g, "");
  } else {
    const words = s.trim().split(/\s+/).filter((w) => w.length > 0);
    const parts: string[] = [];
    for (let i = 0; i < words.length; i += 1) {
      const pair = `${words[i]} ${words[i + 1] ?? ""}`;
      if (Object.hasOwn(EMAIL_PAIRS, pair)) { parts.push(EMAIL_PAIRS[pair]!); i += 1; continue; }
      const w = words[i]!;
      parts.push(Object.hasOwn(EMAIL_WORDS, w) ? EMAIL_WORDS[w]! : w);
    }
    out = parts.join("");
  }
  return isValidEmail(out) ? out : null;
}

/** The repo's one "same mailbox" key (packages/db's emailKey, the twin of 0034's email_key) of a spoken address. */
export function spokenEmailKey(text: string | null | undefined): string | null {
  const e = spokenEmail(text);
  return e === null ? null : emailKey(e);
}

export function candidateOf(row: { id: string; first_name: string | null; last_name: string | null; email_key: string | null }): Candidate {
  return { id: row.id, words: nameWords(`${row.first_name ?? ""} ${row.last_name ?? ""}`), emailKey: row.email_key };
}

/**
 * Spec 5.3's table, top to bottom, as amended (plan P25, P26). `fullName` absent is find_my_booking's case: the
 * sole-candidate row confirms by caller ID ONLY when no name was given, so a name given to confirm_identity on a
 * one-contact number must match it.
 */
export function decideIdentity(input: {
  candidates: readonly Candidate[]; truncated: boolean; required: 1 | 2;
  fullName?: string | null; email?: string | null;
}): Decision {
  const { candidates, truncated, required } = input;
  if (candidates.length === 0 && !truncated) return { kind: "none" };
  if (truncated) return { kind: "cannot_on_this_call" };
  const spoken = nameWords(input.fullName);
  if (required === 1 && candidates.length === 1 && spoken.length === 0) {
    return { kind: "confirmed", contactId: candidates[0]!.id, rung: 1, by: "caller_id" };
  }
  if (required === 2 && !candidates.some((c) => c.emailKey !== null)) return { kind: "cannot_on_this_call" };
  if (spoken.length < 2) return { kind: "ask_name" };
  const key = input.email == null ? null : spokenEmailKey(input.email);
  if (required === 2 && key === null) return { kind: "ask_email" };
  const byName = nameHits(spoken, candidates);
  if (required === 1) {
    if (byName.length === 1) return { kind: "confirmed", contactId: byName[0]!.id, rung: 1, by: "name" };
    if (byName.length > 1) {
      if (key === null) return byName.some((c) => c.emailKey !== null) ? { kind: "ask_email" } : { kind: "miss" };
      const picked = byName.filter((c) => c.emailKey === key);
      return picked.length === 1
        ? { kind: "confirmed", contactId: picked[0]!.id, rung: 2, by: "name_email" }
        : { kind: "miss" };
    }
    return { kind: "miss" };
  }
  const both = byName.filter((c) => c.emailKey !== null && c.emailKey === key);
  return both.length === 1 ? { kind: "confirmed", contactId: both[0]!.id, rung: 2, by: "name_email" } : { kind: "miss" };
}
