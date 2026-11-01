import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { sanitizeSearchTerm } from "./search-term";
import { contactSearchPlan, type ContactSearchPlan } from "./contact-search";
import { phoneNational } from "./dedupe-keys";
import { normalisePhone } from "./phone";
import type { AssigneeFilter } from "./assignment";
import { contactAuthor, type RowAuthor } from "./provenance";
import type { ContactFieldName } from "./proposal-rules";

/**
 * S-02 A2: `companyName` is gone. The Business name is a group now
 * (client-groups.ts), written only through `setContactsBusiness` and kept
 * on `contacts.company_name` by the database's own trigger — `toRow` below
 * must never set that column again, or an ordinary field edit would fight
 * the trigger for it.
 */
export type ContactInput = {
  // `| null` on the names (item 8b-1, plan fix M16): Undo of a filled name restores the null it found.
  firstName?: string | null; lastName?: string | null; email?: string; phone?: string;
  source?: string; custom?: Record<string, unknown>;
};

/**
 * `createContact`'s own input — ContactInput plus Mine/Unassigned's
 * assignee (F-085 part 1, spec §8). Deliberately NOT part of `ContactInput`
 * itself, and `toRow` (shared by `createContact` and `updateContact`) never
 * writes `assigned_to`: an edit that reassigns a customer must go through
 * `assignContacts` (assignment.ts), which checks the new assignee is a
 * member of this account (A5) and moves that contact's open tasks along
 * with it (A4) and emits `contact.assigned` — none of which a plain
 * `updateContact` call does. Splitting the type makes a reassignment through
 * `updateContact` a compile error, not a runtime guard to remember.
 */
export type CreateContactInput = ContactInput & {
  /** `undefined` leaves the column at its default (Unassigned); `null`
   *  explicitly assigns Unassigned; a user id assigns that person. Only
   *  `createContact` accepts this field. */
  assignedTo?: string | null;
  /** item 8c: who made this contact, when the caller already knows (the import, which is always
   *  `import`; a web-chat lead, always `ai`). `undefined` falls back to `contactAuthor(actorType,
   *  actorId)` — the ordinary path, for every other caller. */
  author?: RowAuthor;
  /** S-47e (E7, spec 5.10.1; plan P29): "email_only" dedupes on the email alone: a phone match never makes this
   *  write land on an existing contact (no phone winner, no legacy-key read, no country twin). The direct phone
   *  read still runs, and its first match is filed for the merge queue with the new contact (reason
   *  phone_shared_new_person), so a nickname made into a second person ("Beto" beside "Roberto") is found later.
   *  Sofía passes it when a name on a shared number makes a new person. Read only by createContact (as
   *  assignedTo and author are); toRow never sees it. Absent = today's dedupe. */
  matchBy?: "email_only";
};

// `sort_name` (0030, a stored generated column) rides along on every read —
// not just when sorting by name — because the caller building the NEXT
// cursor (apps/web's contacts/page.tsx) needs whichever column the CURRENT
// sort used off the last row, and that is cheapest to guarantee by always
// selecting it rather than conditionally shaping this string per sort key.
//
// `marketing_email_opted_out_at` (0049) is no longer read (consent PR-3): the
// email stop lives in the ledger, and a later migration drops the column.
// "attribution" (F-157): the first/last-touch jsonb `setAttribution`
// (apps/web/src/lib/forms/enrich.ts) writes — selected now so the drawer's
// lead-source line reads it off the SAME row every other field comes from.
// A SINGLE string literal, deliberately not built with `+`: postgrest-js
// infers each selected column's type by parsing this exact literal at
// compile time, which only works when TypeScript keeps it as a literal
// type. A `+`-joined string widens to plain `string`, and every caller's
// `row.first_name`/`row.phone`/etc then collapses to `GenericStringError`
// (proven: splitting this line with `+` to fit "attribution" broke
// typecheck across a dozen unrelated files, not just this one).
// `assigned_to` (F-085 part 1): the drawer's and the record page's "Assigned
// to" field shows who holds the customer now. Read here, written only by
// assignment.ts (see this file's own header).
// `author_kind`/`author_id` (0091, item 8c): who created the contact, from the five provenance kinds
// (contactAuthor's own set). Read here so the record page's "Added by" fact and the contact-created
// act's Undo (a contact's own `canDelete`/`heldBy` display) have it off the SAME row every other field
// comes from.
// `holds_shared_number` (0098, S-47e E8): a shared number's holding record. The record page redirects it to
// its thread, and the group actions refuse it, off the SAME row (spec 5.12.3, 5.12.4).
// `archived_at`/`archived_by` (0103, contact archive): the record's banner and the drawer read whether, when and by
// whom a contact was archived off the SAME row.
// `merged_into` (0106, F-006): the record page and the drawer redirect a merged-away record to the kept one off
// the SAME row.
const COLS =
  "id, first_name, last_name, email, phone, company_name, source, custom, attribution, created_at, updated_at, sort_name, phone_country_unconfirmed, assigned_to, language, language_source, language_set_at, last_language_signal, last_language_signal_source, last_language_signal_at, language_hint_kept_at, author_kind, author_id, holds_shared_number, archived_at, archived_by, merged_into";

/**
 * A phone as the contact row stores it (F-009, consent chain spec §4.1 item
 * 1): the E.164 `normalisePhone` reads, with its country flag; or, for input
 * that does not read as a number at all ("call after 5", a partial), the
 * trimmed text as typed with no flag — the CRM keeps what the operator wrote,
 * and the send gate refuses it as no number. Blank is null.
 *
 * Exported for the country pick and its tests; every write in this module
 * goes through it, so no path can store a number without its flag.
 */
export function phoneFields(raw: string | null | undefined): { phone: string | null; phone_country_unconfirmed: boolean } {
  const trimmed = raw?.trim() || null;
  if (!trimmed) return { phone: null, phone_country_unconfirmed: false };
  const n = normalisePhone(trimmed);
  return n ? { phone: n.e164, phone_country_unconfirmed: n.unconfirmed } : { phone: trimmed, phone_country_unconfirmed: false };
}

/** The dedupe key of a phone as it WILL be stored: `phoneDigits` of `phoneFields`. */
export function phoneKeyOf(raw: string | null | undefined): string {
  const { phone } = phoneFields(raw);
  return phone ? phoneDigits(phone) : "";
}

/**
 * True when a stored phone carries NO explicit country marker at all — no
 * `+`, no `00`/`011` international prefix, and not the bare NANP/Mexican
 * code forms (eleven digits starting `1`, twelve starting `52`, thirteen
 * starting `521`). Such a number has never been told its country; the
 * fallback lookup in `findDuplicate` merges it into whatever contact a
 * later, country-confirmed read of the same digits belongs to, regardless
 * of how those bare digits would normalise TODAY (ambiguous or not) — a
 * shape check (`startsWith("+")`) is not enough, because "1 (899)
 * 922-1234" carries a marker (the leading `1`) without a `+`.
 */
function hasNoCountryMarker(raw: string): boolean {
  const text = raw.trim();
  if (text.startsWith("+")) return false;
  const digits = text.replace(/[^0-9]/g, "");
  if (digits.startsWith("011") || digits.startsWith("00")) return false;
  if (digits.length === 11 && digits.startsWith("1")) return false;
  if (digits.length === 12 && digits.startsWith("52")) return false;
  if (digits.length === 13 && digits.startsWith("521")) return false;
  return true;
}

/**
 * `currentPhone`, when passed, is the row's phone BEFORE this write (omitted
 * entirely for a brand-new insert, where there is nothing to compare
 * against). An unchanged number keeps whatever flag it already had: a CSV
 * export writes the stored phone as-is, so re-importing an unedited row for
 * a flagged contact must not silently clear a flag nobody has actually
 * resolved by picking a country — the send gate would then text the wrong
 * reading with no one having confirmed it (review C1). Only a genuinely
 * DIFFERENT number recomputes the flag fresh; the explicit country pick
 * (`setContactPhoneCountry`) is the other, deliberate way it changes.
 */
function toRow(input: Partial<ContactInput>, currentPhone?: string | null) {
  const row: Record<string, unknown> = {};
  if (input.firstName !== undefined) row.first_name = input.firstName;
  if (input.lastName !== undefined) row.last_name = input.lastName;
  if (input.email !== undefined) row.email = input.email?.trim() || null;
  if (input.phone !== undefined) {
    const fields = phoneFields(input.phone);
    // Compare against what the STORED number READS AS, never its raw text.
    // The 0054 backfill flagged exactly the rows that are NOT already pure
    // E.164 (plan G4) — a formatted stored value ("+1 (551) 234-5678", "1
    // (551) 234-5678") never equals a freshly-normalised incoming string as
    // RAW text, so comparing against the raw column missed every one of
    // them and cleared their flag on a no-op re-save (review C1,
    // re-review). Falls back to the raw text only when the stored value
    // does not parse as a number at all (kept as typed, same as phoneFields).
    const currentReads = currentPhone !== undefined
      ? (normalisePhone(currentPhone)?.e164 ?? currentPhone)
      : undefined;
    // Unchanged writes NEITHER column — never even the normalised text
    // (re-review, round 2 regression). A row stored bare ("55 1234 5678",
    // written before this deploy, the backfill not yet run, flag still
    // false by default) re-saved with the same number must not become a
    // confirmed-looking "+15512345678" with the flag left stale at false:
    // the gate re-derives a BARE stored number at send time (ambiguous
    // means held), but a "+1…" text with an untouched false flag reads as
    // already-confirmed and would be texted. Leaving both columns alone
    // keeps the bare text bare, so the gate keeps re-deriving and holding
    // it exactly as before this write.
    if (!(currentReads !== undefined && fields.phone !== null && fields.phone === currentReads)) {
      Object.assign(row, fields);
    }
  }
  if (input.source !== undefined) row.source = input.source;
  if (input.custom !== undefined) row.custom = input.custom;
  return row;
}

/**
 * Comparison key for phone dedupe: digits only, with a leading NANP country
 * code folded off. contacts.phone is only trimmed on write, never reshaped
 * — an operator or a web form routinely leaves it as "(956) 292-1696", while
 * an inbound SMS sender's number (or anything already run through
 * lib/voice/phone-number.ts's toE164) arrives as "+19562921696". Both are
 * the same ten digits and must resolve to the same contact; an exact string
 * match on the raw column never sees that, and forked a duplicate contact
 * (and, upstream, a second conversation thread) for the majority phone
 * shape in this database. Comparison-only — this never gets written back;
 * the stored column keeps whatever shape it was entered in.
 */
export function phoneDigits(value: string): string {
  const digits = value.replace(/[^0-9]/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/**
 * Comparison key for email dedupe, and the twin of `email_key` in migration
 * 0034 (0033's original version of this column drifted from this function —
 * see 0034's own comment). Both sides now strip the SAME explicit whitespace
 * class rather than this side calling JS's `.trim()`: space, tab (\t),
 * newline (\n), carriage return (\r), form feed (\f), vertical tab (\v), and
 * NBSP (\u00A0). `.trim()` looks equivalent but is not — it strips the FULL
 * Unicode whitespace set, which Postgres's `trim()`/regex engine cannot be
 * made to reproduce character-for-character, so a `.trim()` on one side and
 * anything short of an identical class on the other is a standing invitation
 * for the two to diverge again. Spelling the class out explicitly, in the
 * same order, on both sides (see `email_key` in
 * packages/db/supabase/migrations/0034_email_key_whitespace.sql) means a
 * reader can compare the two lists directly rather than trusting that a
 * built-in and a hand-written regex happen to agree.
 *
 * Lowercased, and `+suffix` stripped from the local part (non-global — only
 * the first `+...@` run folds): plus-addressing is near-universal, so
 * `dan+bis@example.com` and `dan@example.com` are one mailbox.
 *
 * Gmail's dot-folding is deliberately NOT applied. `john.smith@` and
 * `johnsmith@` are the same mailbox AT GMAIL ONLY; folding dots globally would
 * match two distinct people at every other provider.
 *
 * Comparison-only — like phoneDigits, this is never written back. The stored
 * column keeps whatever the operator typed.
 */
export function emailKey(value: string): string {
  return value
    .replace(/^[ \t\n\r\f\v\u00A0]+|[ \t\n\r\f\v\u00A0]+$/g, "")
    .toLowerCase()
    .replace(/\+[^@]*@/, "@");
}

/** `countryTwin`: a contact holding the SAME ten digits under the OTHER NANP/
 *  Mexican reading of the incoming number — an existing +1 contact when the
 *  new number reads as +52, OR (symmetrically — the follow-up to PR #151,
 *  893f0bc4's note) an existing +52 contact when the new number reads as
 *  +1. Not the same person for sure, so it is recorded for the merge queue,
 *  never merged. */
type DuplicateMatch = { emailMatch: string | null; phoneMatch: string | null; countryTwin: string | null };

/**
 * Both lookups ALWAYS run, and that is the change. The old version returned on
 * the email match and never looked at the phone — so an incoming contact whose
 * email matched one record and whose phone matched ANOTHER was indistinguishable
 * from a plain email match, and the second record silently stayed a duplicate.
 * That is how a duplicate gets created quietly, and it is what the caller now
 * flags (spec §5).
 *
 * Each lookup is a single indexed equality on the generated key columns from
 * migration 0033. The previous phone path had a fast path plus a fallback that
 * pulled every non-null phone on the account into memory and compared in JS —
 * once per inserted contact. The keys make the fallback unnecessary: the
 * database already holds the normalized form, so the same comparison is an
 * index lookup.
 *
 * --- WHY THESE ARE TWO PLAIN FILTERS, AND WHY NEITHER IS AN `ilike` ---
 * This lookup is reached from a PUBLIC form, so both operands are
 * attacker-controlled, and it has been the site of that bug class twice.
 * Recorded here because two comments further down this file cite this block as
 * the landmark for it:
 *
 *   1. It once built `email.ilike."${email}",phone.eq."${phone}"` as one
 *      interpolated `.or()` string. An email containing `"` or `,` breaks out
 *      of PostgREST's filter grammar. `.eq()` sends its operand as a parameter,
 *      so nothing can escape it — see `quoteFilterValue` below for the rule
 *      that applies when a value genuinely must be interpolated into `.or()`.
 *   2. It then discarded the query's `error`, so a filter that failed to parse
 *      silently became "no duplicate found" and wrote a second contact row
 *      rather than failing visibly. Both branches below check `error` and throw.
 *   3. The email side matched with `.ilike()`, whose operand is a SQL ILIKE
 *      *pattern*: `%` and `_` stayed live wildcards, so a submitted
 *      `%@example.com` could match — and hijack — any contact at that domain.
 *      An `escapeLikePattern` helper neutralized them. It is gone with the
 *      `ilike`: `.eq("email_key", …)` has no pattern grammar at all, so `%` and
 *      `_` are literal characters by construction rather than by escaping. The
 *      tests that pinned that behaviour are unchanged and still pass.
 *
 * 0106: a merged-away record keeps its phone and email (owner ruling D8), so a hit on it answers the kept
 * record; the one-hop pointer is all there is, because 0106 flattens chains.
 */
async function findDuplicate(
  db: SupabaseClient, accountId: string, email?: string, phone?: string,
  // S-47e (plan P29): with emailOnly the direct phone read still runs (its match is filed, never the winner,
  // createContact decides that), and the legacy-key fallback below is skipped. Both phone reads skip a
  // shared number's holding record (0098; spec 5.12.3): it is never a phone match and never a country twin.
  opts: { emailOnly?: boolean } = {},
): Promise<DuplicateMatch> {
  const result: DuplicateMatch = { emailMatch: null, phoneMatch: null, countryTwin: null };

  const eKey = email ? emailKey(email) : "";
  if (eKey) {
    const { data, error } = await db.from("contacts").select("id, merged_into")
      .eq("account_id", accountId).eq("email_key", eKey).limit(1);
    if (error) throw new Error(`contact dedupe failed: ${error.message}`);
    if (data && data.length > 0) result.emailMatch = (data[0]!.merged_into as string | null) ?? (data[0]!.id as string);
  }

  const pKey = phone ? phoneKeyOf(phone) : "";
  if (pKey) {
    const { data, error } = await db.from("contacts").select("id, merged_into")
      .eq("account_id", accountId).eq("holds_shared_number", false).eq("phone_key", pKey).limit(1);
    if (error) throw new Error(`contact dedupe failed: ${error.message}`);
    if (data && data.length > 0) result.phoneMatch = (data[0]!.merged_into as string | null) ?? (data[0]!.id as string);

    // 0033's phone_key is the stored DIGITS, so a contact saved before F-009
    // as "899 922 1234" keys 8999221234 while its +52 reading keys
    // 528999221234 (review R1-I3). `phoneDigits` strips a leading NANP "1"
    // off any 11-digit key but leaves a Mexican "52"/"521" prefix alone — a
    // 12/13-digit key is never touched by that rule at all. The practical
    // effect: a US/+1 number's key is ALWAYS the bare ten digits, identical
    // in shape to a legacy bare-stored (no-country-marker) number, so the
    // direct `.eq("phone_key", pKey)` above already finds a bare-ten-digit
    // OR an explicit-+1-stored twin for an incoming +1 number. It can never
    // find an explicit +52-stored twin on those same ten digits, though,
    // because THAT key keeps its "52"/"521" prefix and never equals the bare
    // pKey. The fallback below is symmetric for exactly that reason: an
    // incoming 12-digit +52 key checks the bare and 521-prefixed legacy MX
    // shapes on its own ten digits (first branch), and an incoming bare
    // 10-digit key that reads as a firm +1 claim checks the 52- and
    // 521-prefixed MX shapes on ITS ten digits (second branch, narrowed to
    // only a firm +1 reading — see its own comment below). Before this fix
    // only the first branch existed, so saving the +52 contact FIRST and the
    // +1 one SECOND found nothing at all, not even a flag (follow-up from PR
    // #151, 893f0bc4's note: "+52 after +1 flags; +1 after +52 doesn't").
    //
    // Per the spec (orchestrator decision): the same-or-twin call is decided
    // by what the stored number READS AS, never by whether its raw text
    // happens to carry a "+" (re-review: "+52 1 899…" HAS a "+" but reads as
    // the SAME +52 number, and must merge; "1 (899) 922-1234" has NO "+" but
    // reads as a firm +1 claim, and must be a twin — shape alone got both of
    // those backwards). A stored number with NO explicit country marker at
    // all — plain digits, however punctuated — hasn't been told its country
    // yet and is unconditionally THIS contact, regardless of how those bare
    // digits would normalise today (ambiguous or not). A stored number that
    // DOES carry an explicit marker (a "+", `00`/`011`, or the bare
    // NANP/Mexican code forms) is the SAME contact only if it reads as the
    // exact number being matched; otherwise (it reads as the OTHER country,
    // or anything else) it is left alone as a genuine country TWIN, flagged
    // for a human to resolve.
    //
    // No `.limit(1)`: with a bare-stored contact and an explicitly-coded
    // contact both keyed under the same bare ten digits, taking only
    // whichever Postgres returns first could hand back the explicit one and
    // miss the bare (same) contact entirely, minting a THIRD contact (review
    // m3). Fetch every candidate and prefer the one that reads as the same
    // contact.
    let legacyTenDigits: string | null = null;
    let legacyKeys: string[] = [];
    if (!opts.emailOnly && !result.phoneMatch && /^52\d{10}$/.test(pKey)) {
      legacyTenDigits = pKey.slice(2);
      legacyKeys = [legacyTenDigits, `521${legacyTenDigits}`];
    } else if (!opts.emailOnly && !result.phoneMatch && /^\d{10}$/.test(pKey) && phone === `+1${pKey}`) {
      // Narrowed to a FIRM +1 reading of the incoming number, not merely a
      // bare ten-digit key: `phoneKeyOf` keys unparseable typed text (kept
      // as-is by `phoneFields` when it cannot normalise — "0123456789", a
      // leading-zero ten digits `normalisePhone` refuses outright) on its
      // bare digits too, which would otherwise take this branch and queue a
      // spurious twin flag against any contact that merely happens to share
      // those digits under an explicit +52. `phone === "+1" + pKey` is true
      // only when this number is actually stored as a confirmed-or-ambiguous
      // +1 E.164 value.
      legacyTenDigits = pKey;
      legacyKeys = [`52${pKey}`, `521${pKey}`];
    }
    if (legacyTenDigits) {
      const { data: bare, error: bareErr } = await db.from("contacts").select("id, phone, merged_into")
        .eq("account_id", accountId).eq("holds_shared_number", false).in("phone_key", legacyKeys).limit(10);
      if (bareErr) throw new Error(`contact dedupe failed: ${bareErr.message}`);
      const hits = (bare ?? []) as { id: string; phone: string | null; merged_into: string | null }[];
      const bareHit = hits.find((h) =>
        h.phone !== null && (hasNoCountryMarker(h.phone) || normalisePhone(h.phone)?.e164 === `+${pKey}`));
      if (bareHit) result.phoneMatch = bareHit.merged_into ?? bareHit.id;
      else if (hits[0]) result.countryTwin = hits[0]!.merged_into ?? hits[0]!.id;
    }
  }

  return result;
}

/** One pair onto contact_duplicate_flags (0033), for the merge queue. A
 *  repeat (23505) is the designed no-op. Called AFTER the write it is about
 *  has succeeded, so a failure here is logged, never thrown: throwing would
 *  report a failure for a write that happened (review R3-M11). */
async function flagDuplicatePair(
  db: SupabaseClient, accountId: string, one: string, other: string, reason: string,
): Promise<boolean> {
  const [contactA, contactB] = [one, other].sort();
  const { error } = await db.from("contact_duplicate_flags")
    .insert({ account_id: accountId, contact_a: contactA, contact_b: contactB, reason });
  if (error && error.code !== "23505") {
    // The Postgres code only, never the message: loggableError lives in
    // apps/web, which packages/db cannot import, and a code carries no one's data.
    console.error(`contact duplicate flag (${reason}) for account ${accountId} not recorded: code ${error.code ?? "none"}`);
    return false;
  }
  return true;
}

/**
 * The post-write duplicate check both `updateContact` and
 * `fillContactBlanks` run (D-012, reached by two different write paths —
 * a direct edit and a proposal-approval/booking/voice fill). Checks ONLY
 * the columns `written` actually names (an unchanged phone, or a field
 * this call never wrote at all, is never checked — there is nothing new
 * to collide with) for a match against a DIFFERENT contact's
 * `email_key`/`phone_key`, and flags the pair via the existing
 * `flagDuplicatePair`/`contact_duplicate_flags` queue on a hit.
 *
 * Called AFTER the write it is about has already succeeded, and never
 * blocks or throws: the write that landed is the truth about this row
 * (same policy as `setContactPhoneCountry` choosing a phone's country),
 * and a failed check here is logged, never thrown — a throw would report
 * a failed write that actually succeeded (review R3-M11's rule).
 *
 * Returns whether EITHER column was flagged — a fresh flag, or the
 * designed no-op repeat of one already on file (`flagDuplicatePair`
 * itself returns `true` for both) — so a caller that reports write-time
 * progress (`applyImportBatch`'s `flagged` count) can count it.
 */
async function flagDuplicatesAfterWrite(
  db: SupabaseClient, accountId: string, contactId: string,
  written: { email?: unknown; phone?: unknown },
): Promise<boolean> {
  let flagged = false;
  if (typeof written.email === "string" && written.email) {
    const eKey = emailKey(written.email);
    const { data: twins, error: twinErr } = await db.from("contacts").select("id")
      .eq("account_id", accountId).eq("email_key", eKey).neq("id", contactId).is("merged_into", null).limit(1);
    if (twinErr) {
      console.error(`contact duplicate check (email) for account ${accountId} failed after the write: code ${twinErr.code ?? "none"}`);
    } else {
      const twin = (twins ?? [])[0] as { id: string } | undefined;
      if (twin) flagged = (await flagDuplicatePair(db, accountId, contactId, twin.id, "email_match_on_edit")) || flagged;
    }
  }
  if (typeof written.phone === "string" && written.phone) {
    // S-47e (spec 5.12.3): no duplicate flag ever pairs a household member with the number's holding record.
    // 0106: nor a merged-away record — it is never a fresh duplicate, only a hit the earlier reads already resolved.
    const { data: twins, error: twinErr } = await db.from("contacts").select("id")
      .eq("account_id", accountId).eq("holds_shared_number", false)
      .eq("phone_key", phoneDigits(written.phone)).neq("id", contactId).is("merged_into", null).limit(1);
    if (twinErr) {
      console.error(`contact duplicate check (phone) for account ${accountId} failed after the write: code ${twinErr.code ?? "none"}`);
    } else {
      const twin = (twins ?? [])[0] as { id: string } | undefined;
      if (twin) flagged = (await flagDuplicatePair(db, accountId, contactId, twin.id, "phone_match_on_edit")) || flagged;
    }
  }
  return flagged;
}

export async function createContact(
  db: SupabaseClient, accountId: string, input: CreateContactInput, actorId: string,
  actorType: ActorType = "user",
  // A Technician's own RLS-bound client cannot see a duplicate sitting
  // outside their assigned customers (0068 §4a), so a flag writer that ran
  // on `db` would silently find nothing to record. Defaults to `db` for
  // every other caller (the agency, Owner/Staff, the public form), whose
  // client already sees the whole account. Pass serviceDb() for a
  // Technician's own insert.
  flagDb: SupabaseClient = db,
): Promise<{ id: string; existing: boolean; flagged: boolean }> {
  const email = input.email?.trim().toLowerCase();
  // The phone as it will be STORED, so the event names what the row holds.
  const phone = phoneFields(input.phone).phone ?? undefined;
  const emailOnly = input.matchBy === "email_only";
  const match = await findDuplicate(db, accountId, email || undefined, phone, { emailOnly });
  // S-47e (plan P29): with emailOnly a phone match never wins; it is filed with the new contact below.
  const winner = emailOnly ? match.emailMatch : (match.emailMatch ?? match.phoneMatch);

  // Two DIFFERENT existing contacts both look like this person. The row still
  // lands on the email match, unchanged — but the second one is the thing that
  // used to vanish, and it is exactly what a merge tool needs to find later.
  const conflict =
    match.emailMatch !== null &&
    match.phoneMatch !== null &&
    match.emailMatch !== match.phoneMatch;

  let flagged = false;
  if (conflict) {
    const [contactA, contactB] = [match.emailMatch!, match.phoneMatch!].sort();
    // The unique index makes a repeat a no-op rather than a second row, so a
    // 23505 here is the DESIGNED outcome, not a failure. Anything else is real
    // and must not be swallowed: a flag that silently fails to write leaves the
    // queue looking empty, which is worse than not having one.
    const { error } = await flagDb.from("contact_duplicate_flags")
      .insert({ account_id: accountId, contact_a: contactA, contact_b: contactB,
                reason: "email_phone_conflict" });
    if (error && error.code !== "23505") {
      throw new Error(`contact duplicate flag failed: ${error.message}`);
    }
    flagged = true;
  }

  // An email match still queues the country twin its +52 number found
  // (re-review minor 12): the person is the email's contact, and the +1 one
  // with the same ten digits is for the merge tool to judge.
  if (winner && match.countryTwin !== null && match.countryTwin !== winner) {
    flagged = (await flagDuplicatePair(flagDb, accountId, winner, match.countryTwin, "phone_country_twin")) || flagged;
  }
  if (winner) return { id: winner, existing: true, flagged };

  // assigned_to is written HERE, not inside toRow: toRow is shared with
  // updateContact, which must never be able to set it (see
  // CreateContactInput's own comment). author_kind/author_id likewise: an
  // explicit input.author (the import, a web-chat lead) wins; every other
  // caller gets contactAuthor's ordinary mapping of the actor it already
  // passes. Never through toRow — updateContact must never be able to
  // rewrite who made a contact.
  const author = input.author ?? contactAuthor(actorType, actorId);
  const { data, error } = await db.from("contacts")
    .insert({
      account_id: accountId, ...toRow(input),
      ...(input.assignedTo !== undefined ? { assigned_to: input.assignedTo } : {}),
      author_kind: author.authorKind, author_id: author.authorId,
    }).select("id").single();
  if (error || !data) throw new Error(`createContact failed: ${error?.message}`);
  await emit(db, accountId, "contact.created", actorId, { contactId: data.id, email, phone },
    actorType);
  // S-47e (plan P29): a new person on a number someone already has goes to the merge queue with them, so a
  // nickname made into a second person ("Beto" beside "Roberto") is found later. The number stays shared until
  // staff merge the two. Logged, never thrown, like every flag after a write that landed.
  const sharedFlagged = emailOnly && match.phoneMatch !== null
    && await flagDuplicatePair(flagDb, accountId, data.id, match.phoneMatch, "phone_shared_new_person");
  const twinFlagged = match.countryTwin !== null
    && await flagDuplicatePair(flagDb, accountId, data.id, match.countryTwin, "phone_country_twin");
  return { id: data.id, existing: false, flagged: twinFlagged || sharedFlagged };
}

/**
 * After a Technician adds a customer (owner ruling §13.3): pairs it with any
 * OTHER contact in the account sharing its email_key or phone_key, reason
 * "hidden_match", so the Owner's duplicates queue sees what the Technician's
 * RLS-bound lookup could not. Pass serviceDb(). Returns the pairs written.
 */
export async function flagMatchesOf(db: SupabaseClient, accountId: string, contactId: string): Promise<number> {
  const { data: me, error } = await db.from("contacts").select("email_key, phone_key")
    .eq("account_id", accountId).eq("id", contactId).maybeSingle();
  if (error) throw new Error(`flagMatchesOf read failed: ${error.message}`);
  if (!me) return 0;
  const ors = [
    me.email_key ? `email_key.eq.${quoteFilterValue(String(me.email_key))}` : null,
    me.phone_key ? `phone_key.eq.${quoteFilterValue(String(me.phone_key))}` : null,
  ].filter((v): v is string => v !== null);
  if (ors.length === 0) return 0;
  // S-47e (spec 5.12.3): a shared number's holding record is nobody's duplicate. 0106: nor is a merged-away
  // record — a hit on one is for the record it points at to find on its own account, not for this Technician's
  // new contact to be paired against a hidden pointer.
  const { data: hits, error: hErr } = await db.from("contacts").select("id")
    .eq("account_id", accountId).eq("holds_shared_number", false).neq("id", contactId)
    .is("merged_into", null).or(ors.join(",")).limit(20);
  if (hErr) throw new Error(`flagMatchesOf lookup failed: ${hErr.message}`);
  let written = 0;
  for (const h of (hits ?? []) as { id: string }[]) {
    const [a, b] = [contactId, h.id].sort();
    const { error: fErr } = await db.from("contact_duplicate_flags")
      .insert({ account_id: accountId, contact_a: a, contact_b: b, reason: "hidden_match" });
    // Same rule as the sibling email_phone_conflict insert above: the unique
    // index makes a repeat (23505) the DESIGNED no-op, but anything else is
    // real and must not be swallowed — a flag that silently fails to write
    // leaves the Owner's duplicates queue looking empty, which is worse than
    // not having one. Unlike flagDuplicatePair (called AFTER some OTHER
    // write has already succeeded, so a throw there would misreport that
    // write as failed), flagMatchesOf's only job is this write, so a throw
    // here reports exactly what happened.
    if (fErr && fErr.code !== "23505") {
      throw new Error(`flagMatchesOf insert failed: ${fErr.message}`);
    }
    if (!fErr) written += 1;
  }
  return written;
}

export async function updateContact(
  db: SupabaseClient, accountId: string, contactId: string,
  input: Partial<ContactInput>, actorId: string,
  actorType: ActorType = "user",
): Promise<{ flagged: boolean }> {
  // Read the phone as it stands BEFORE this write, so toRow can tell an
  // unchanged number (keep the flag) from a genuinely different one
  // (recompute it) — review C1. Only fetched when a phone is actually being
  // written; every other update stays a single round trip, as before.
  let currentPhone: string | null | undefined;
  if (input.phone !== undefined) {
    const { data, error: readError } = await db.from("contacts").select("phone")
      .eq("account_id", accountId).eq("id", contactId).maybeSingle();
    if (readError) throw new Error(`updateContact phone read failed: ${readError.message}`);
    currentPhone = (data as { phone: string | null } | null)?.phone ?? null;
  }
  const row = toRow(input, currentPhone);
  const { error } = await db.from("contacts")
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", contactId);
  if (error) throw new Error(`updateContact failed: ${error.message}`);
  await emit(db, accountId, "contact.updated", actorId, { contactId, fields: Object.keys(input) },
    actorType);

  // D-012: an edit that lands this contact's email or phone on another
  // contact's dedupe key used to create a silent duplicate — same key, two
  // rows, nothing recorded, never reaching the merge queue the way
  // createContact's and setContactPhoneCountry's own duplicate checks do.
  // `flagDuplicatesAfterWrite` is the shared check `fillContactBlanks` below
  // also runs, for the SAME reason reached through a different write path.
  //
  // Review correction: `row.phone` is skipped by `toRow` itself when the
  // number is unchanged (the `currentPhone` comparison above) — but `row.email`
  // carries NO such guard; `toRow` sets it on every call that names
  // `input.email`, changed or not. So a full-form save that resubmits the
  // SAME email every time re-runs this check every time too. That is
  // harmless, not a bug: `.neq("id", contactId)` self-excludes, so a save
  // that didn't actually move the key onto a DIFFERENT contact finds no
  // twin and flags nothing — it is extra, needless work, never a false flag.
  const flagged = await flagDuplicatesAfterWrite(db, accountId, contactId, row);
  return { flagged };
}

/**
 * Fills ONLY blank fields on an existing contact — the voice dedupe
 * follow-up (a returning caller's name/email must not stay "Caller"/NULL,
 * but a misheard name must never clobber a good record). Blank = null or
 * empty after trim. "Caller" with no last name is our own finish-call
 * placeholder and counts as blank for the name pair only.
 * Returns the column names actually written; [] means no update ran.
 */
export async function fillContactBlanks(
  db: SupabaseClient, accountId: string, contactId: string,
  input: { firstName?: string; lastName?: string; email?: string; phone?: string },
  actorId: string, actorType: ActorType = "user",
): Promise<string[]> {
  return (await fillContactBlanksReport(db, accountId, contactId, input, actorId, actorType)).fields;
}

/** `patch`'s snake_case column name, keyed to the field name an ai_acts row names (item 8c). */
const COLUMN_FIELD: Readonly<Record<string, ContactFieldName>> = {
  first_name: "firstName", last_name: "lastName", email: "email", phone: "phone",
};

/**
 * `fillContactBlanks`'s body, also answering whether the fill raised a duplicate flag (item 8b-1, plan
 * deviation 11): Undo of an accepted contact-field suggestion tells the person the possible duplicate it
 * found is still in Duplicates. One write path; `fillContactBlanks` reads `.fields` off this.
 *
 * `prior`/`written` (item 8c): what a `contact_field_filled` act needs to record, keyed by the camel
 * field name and present only for a column this call actually wrote. `prior` is the column as read
 * BEFORE the write (null when it was genuinely blank); `written` is the STORED form (`phoneFields`'s
 * E.164 for a phone, never the raw input the caller passed).
 */
export async function fillContactBlanksReport(
  db: SupabaseClient, accountId: string, requestedId: string,
  input: { firstName?: string; lastName?: string; email?: string; phone?: string },
  actorId: string, actorType: ActorType = "user",
): Promise<{
  fields: string[]; flagged: boolean;
  prior: Partial<Record<ContactFieldName, string | null>>; written: Partial<Record<ContactFieldName, string>>;
}> {
  let contactId = requestedId;
  let row = await getContact(db, accountId, contactId);
  if (!row) throw new Error("fillContactBlanks: no such contact");
  // 0106 (owner ruling D8): a call that ends after its customer was merged still fills the record that
  // merge kept — the one-hop pointer is all there is, because 0106 flattens chains.
  if (row.merged_into) {
    contactId = row.merged_into;
    row = await getContact(db, accountId, contactId);
    if (!row) throw new Error("fillContactBlanks: no such contact");
  }
  const blank = (v: unknown) => v == null || String(v).trim() === "";

  const patch: Record<string, unknown> = {};
  const nameIsPlaceholder = row.first_name === "Caller" && blank(row.last_name);
  const incomingFirst = input.firstName?.trim();
  const incomingLast = input.lastName?.trim();

  // Whether a blank last_name is safe to fill on its own — i.e. without a
  // first_name write riding along in the same call. "Safe" means there's no
  // real first name on file to contradict: it's blank, it's our own
  // "Caller" placeholder, or it already matches the incoming first name
  // (case-insensitive, trimmed). This is the guard that stops "Smith" from
  // grafting onto a contact whose actual first name differs from this
  // caller's — a stranger who merely dedupe-matched on phone.
  const firstNameCompatible = blank(row.first_name) || nameIsPlaceholder ||
    (!!incomingFirst && incomingFirst.toLowerCase() === String(row.first_name).trim().toLowerCase());

  if (incomingFirst && (blank(row.first_name) || nameIsPlaceholder)) {
    patch.first_name = incomingFirst;
    if (incomingLast && blank(row.last_name)) patch.last_name = incomingLast;
  } else if (incomingLast && blank(row.last_name) && firstNameCompatible) {
    // Independent fill: first_name isn't being written this call (it's
    // already a real, non-placeholder name), but last_name can still be
    // filled on its own — e.g. a contact created as just "John" who a later
    // caller identifies as "John Smith" must not stay surnameless forever.
    patch.last_name = incomingLast;
  }
  const incomingEmail = input.email?.trim().toLowerCase();
  if (incomingEmail && blank(row.email)) patch.email = incomingEmail;
  const incomingPhone = input.phone?.trim();
  if (incomingPhone && blank(row.phone)) patch.phone = incomingPhone;

  const filled = Object.keys(patch);
  if (filled.length === 0) return { fields: [], flagged: false, prior: {}, written: {} };
  // The phone is stored as every write stores it, with its country flag —
  // and that flag is a column this call actually writes, so it belongs in
  // the reported/emitted field list too (review m7), not just in `writtenRow`.
  const writtenRow = "phone" in patch ? { ...patch, ...phoneFields(String(patch.phone)) } : patch;
  const reportedFields = "phone" in patch ? [...filled, "phone_country_unconfirmed"] : filled;

  // item 8c: what the act needs, read BEFORE the write (prior) and from the column's actual stored
  // form (written) — both keyed by the camel field name, only for columns `patch` names.
  const prior: Partial<Record<ContactFieldName, string | null>> = {};
  const written: Partial<Record<ContactFieldName, string>> = {};
  for (const col of filled) {
    const field = COLUMN_FIELD[col];
    if (!field) continue;
    prior[field] = (row as Record<string, unknown>)[col] as string | null ?? null;
    const storedValue = col === "phone" ? writtenRow.phone : writtenRow[col];
    if (typeof storedValue === "string") written[field] = storedValue;
  }

  const { error } = await db.from("contacts")
    .update({ ...writtenRow, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", contactId);
  if (error) throw new Error(`fillContactBlanks failed: ${error.message}`);
  await emit(db, accountId, "contact.updated", actorId, { contactId, fields: reportedFields }, actorType);
  // D-012 via this fill path too: a returning caller's email/phone can land
  // on a DIFFERENT contact's dedupe key exactly as a direct edit can (the
  // call proposal approval, the /b booking form, finish-call, textback and
  // the voice tools all reach this function). `writtenRow` already carries
  // only the columns THIS call is actually about to write — `email`/`phone`
  // are absent from it whenever `patch` never named them — so the shared
  // check below runs for no more than those.
  const flagged = await flagDuplicatesAfterWrite(db, accountId, contactId, writtenRow);
  return { fields: reportedFields, flagged, prior, written };
}

const FIELD_COLUMN: Readonly<Record<ContactFieldName, string>> = {
  firstName: "first_name", lastName: "last_name", email: "email", phone: "phone",
};

/**
 * Field undo (item 8c): puts one column back to `restore`, ONLY while it still holds exactly
 * `expected` (the compare-and-swap `fillContactBlanksReport`'s `prior`/`written` pair is for) — a
 * person's own later edit means `"changed"`, never clobbered. A phone restore writes `phoneFields`'s
 * stored form (both columns, same as every other phone write); any other restore (an email restore of
 * null included) writes `restore` as given. Emits `contact.updated` as `actorId` on `"restored"` only;
 * runs on the REQUEST client (contacts' column UPDATE grant, 0053, already lets a signed-in person
 * write these columns) so RLS decides who may call it at all.
 */
export async function restoreContactFieldIf(
  db: SupabaseClient, accountId: string, contactId: string, field: ContactFieldName,
  expected: string | null, restore: string | null, actorId: string,
): Promise<"restored" | "changed"> {
  const column = FIELD_COLUMN[field];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (field === "phone") {
    const fields = phoneFields(restore);
    patch.phone = fields.phone;
    patch.phone_country_unconfirmed = fields.phone_country_unconfirmed;
  } else {
    patch[column] = restore;
  }
  let q = db.from("contacts").update(patch).eq("account_id", accountId).eq("id", contactId);
  // PostgREST's `eq.null` is not guaranteed IS NULL across every filter context the way `.is()` is
  // (`updateContact`'s own phone comparisons take the same care); a restore back to a blank value
  // compares with `.is()`.
  q = expected === null ? q.is(column, null) : q.eq(column, expected);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`restoreContactFieldIf failed: ${error.message}`);
  if ((data ?? []).length === 0) return "changed";
  await emit(db, accountId, "contact.updated", actorId, { contactId, fields: [column] }, "user");
  return "restored";
}

/**
 * The newest person who edited `field` after `since` (item 8c): the act-kind display's `changedBy`
 * reason names who. Soft: a Technician's RLS fence on `events` sees none, and any read failure, both
 * answer null rather than throw — this is a display nicety, never load-bearing. Reads on the
 * REQUEST client, so RLS decides what the caller may see at all.
 * Both forms of the field's name count (final review M-5): `updateContact` emits the camel name
 * ("firstName"), while a blank-fill and `restoreContactFieldIf` emit the column ("first_name").
 */
export async function lastFieldEditor(
  db: SupabaseClient, accountId: string, contactId: string, field: ContactFieldName, since: string,
): Promise<string | null> {
  const names = [field, FIELD_COLUMN[field]];
  try {
    const { data, error } = await db.from("events").select("actor_id, payload")
      .eq("account_id", accountId).eq("type", "contact.updated").eq("actor_type", "user")
      .eq("payload->>contactId", contactId).gt("created_at", since)
      .order("created_at", { ascending: false }).limit(50);
    if (error) return null;
    for (const r of (data ?? []) as { actor_id: string; payload: { fields?: unknown } }[]) {
      const fields: unknown = r.payload?.fields;
      if (Array.isArray(fields) && names.some((n) => fields.includes(n))) return r.actor_id;
    }
    return null;
  } catch {
    return null;
  }
}

/** The three columns the contacts list can be sorted by, and the two
 *  directions — Task 3b's server-side sort, replacing the old client-side
 *  one that could only ever reorder the rows already in the browser. */
export type SortKey = "name" | "company" | "created";
export type SortDir = "asc" | "desc";
export type ContactSort = { key: SortKey; dir: SortDir };

/** `name`/`company` sort on nullable columns (a contact can have neither a
 *  name nor a company); `created` sorts on `created_at`, which is `not
 *  null`. Nulls sort LAST in BOTH directions (0030's own design, so a
 *  nameless contact does not interleave among the Ns) — this table is what
 *  tells the cursor's `.or()` below whether it needs the extra
 *  `column.is.null` disjunct to step across that boundary. */
const SORT_COLUMN: Record<SortKey, string> = {
  name: "sort_name",
  company: "company_name",
  created: "created_at",
};
const SORT_NULLABLE: Record<SortKey, boolean> = {
  name: true,
  company: true,
  created: false,
};

/**
 * Escapes a value for embedding inside a PostgREST `.or()` filter string.
 *
 * The cursor's `v` (apps/web/src/lib/cursor.ts's `RowCursor`) is DELIBERATELY
 * opaque now — `parseCursor` checks only that it is a string or null, never
 * its shape. The `created_at` branch below used to interpolate its cursor
 * value unescaped, which was safe only because the OLD parser's `isTs` regex
 * validated it as a timestamp first, excluding every character PostgREST's
 * grammar treats specially. A name or company has no such shape: a real one
 * can contain a comma, a period, parentheses, or a double quote — this
 * function and its `sanitizeSearchTerm` neighbour exist because this exact
 * class of bug already happened here twice (see the block comment above
 * `findDuplicate`). PostgREST's own escape rule is to double-quote the
 * value and backslash-escape a literal `\` or `"` inside it — backslash
 * first, so an input holding both round-trips either way. Proven against the
 * real database in this file's own "PostgREST-reserved character" test.
 */
function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** A row's position in this list's (possibly sorted) ordering — `v` is the
 *  CURRENT sort column's own value off the last row shown, `id` the
 *  tiebreaker that makes it total. Structurally identical to apps/web's
 *  `RowCursor` (apps/web/src/lib/cursor.ts); redeclared because @bis/db must
 *  not import from the app. */
export type ContactCursor = { v: string | null; id: string };

/**
 * The contact search's match rule, written as one PostgREST `.or()` argument, or null for "no filter". Since the
 * F-092 scale follow-up (0110, plan T6) no reader sends it: `listContacts`, `countContacts` and `searchContacts`
 * read a search through public.contacts_matching with `contactMatchArgs` (below), and 0110's matcher runs these
 * same arms in this same order. It stays as the ORACLE: contact-match-schema.test.ts holds the matcher to it (rows
 * and count, per role), contact-search-live.test.ts holds the app's reads to it through the real PostgREST, and
 * `contactMatchArgs` is null exactly when this is. A change to the arms is a change to BOTH this and the matcher, in
 * one pull request, with a new migration (0110's LOAD-BEARING). Exported for those tests; NOT barrelled through
 * index.ts, as `phoneSearchDigits` is not.
 *
 * Was a local `.replace(/[%,()]/g, "")`, which left `"` and `\` in place —
 * both break the interpolated .or() string below (see search-term.ts, and
 * this file's own comment block above findDuplicate). Harmless while only
 * a deliberate CRM search reached it; P6 put this call behind every keystroke
 * of the ⌘K palette.
 *
 * D-009's phone half: `phone` is stored E.164 ("+19565550199"), which
 * contains none of the punctuation a typed, formatted number does — "(956)
 * 555-0199" is not a literal substring of it no matter how faithfully the
 * typed term survives sanitizing. Matched on DIGITS instead (`phoneDigits`,
 * this file's own normalisation and `phone_key`'s, 0033): extracted from the
 * RAW `search`, not `s` — by the time `s` exists the generic sanitizer above
 * has already dropped the parens/dash, so reading off `s` would have worked
 * too, but reading `search` keeps this branch legible without depending on
 * what the OTHER branches' sanitizer happened to leave behind.
 *
 * GATED ON THE TERM LOOKING LIKE A PHONE (`contactSearchPlan`'s `phone`, the
 * new key, and its `keptKey`, today's kept clause: both in contact-search.ts),
 * not merely on having any digit in it at all — review finding (first pass):
 * "maria5@example.com" or "Suite 9" each carry one digit, and an
 * unconditional `phone_key.ilike.%5%`/`%9%` matched almost every contact
 * with a phone containing that digit, turning a name/email search into a
 * near-random phone hit via `.or()`'s union. Shape AND a 4-digit floor
 * (field-input.ts's own `PHONE_CHARS`, reused rather than re-declared) are
 * both required: a term built entirely of phone punctuation and digits,
 * with enough of them that a short, common digit run ("2026", a year
 * someone types in an unrelated note) can't alone light up every phone
 * ending the same way by accident. That shape and floor now live in
 * contact-search.ts (`contactSearchPlan`, owner ruling Q2: still 4).
 *
 * F-092 part 1 (spec 4.1, 4.4, D4): the folded words and the national ten are ADDED arms, so nothing found
 * before stops being found. Every word of the typed name must appear in 0108's `search_name` (first, last and
 * business name, each folded by 0106's `app.contact_name_fold`), in any order, as `and(...)` inside the `or`;
 * a word is `[a-z0-9]+` by construction (nameFold), so it needs no sanitizing and carries no grammar or
 * wildcard. A phone-shaped term adds its key digits on `phone_key` (a leading "+" names a country code, so
 * "+1 956 55" searches 95655) and, for a full +52 shape `phone_key` misses, the ten on 0106's
 * `phone_national`. Today's own `phone_key` clause (the term's raw digits, af5976fa) is KEPT whenever the new
 * key does not cover it (its digits do not contain the new key): "+1 956" and "+521 899 12" found a stored
 * key holding 1956 or a pre-F-009 "+521..." number before this change and still do. That kept key is the plan's
 * `keptKey` (contact-search.ts), so the route's `phoneMatches` reads the same rule and shows such a number as
 * the match (T4 review, Minor 3). The four raw arms stay
 * first and unchanged; a name the fold empties (Chinese, Arabic) is found by them alone.
 */
export function contactSearchFilter(search: string | undefined): string | null {
  const parts = searchParts(search);
  if (!parts) return null;
  const { s, plan } = parts;
  const clauses = [`first_name.ilike.%${s}%`, `last_name.ilike.%${s}%`, `email.ilike.%${s}%`, `phone.ilike.%${s}%`];
  const words = plan.tokens.map((t) => `search_name.ilike.%${t}%`);
  if (words.length === 1) clauses.push(words[0]!);
  else if (words.length > 1) clauses.push(`and(${words.join(",")})`);
  if (plan.phone) clauses.push(`phone_key.ilike.%${plan.phone.key}%`);
  if (plan.keptKey) clauses.push(`phone_key.ilike.%${plan.keptKey}%`);
  if (plan.phone?.national) clauses.push(`phone_national.ilike.%${plan.phone.national}%`);
  return clauses.join(",");
}

/** The one reading of a typed search both `contactSearchFilter` and `contactMatchArgs` start from, so they are
 *  null for exactly the same terms. "%" or "()" sanitizes to "": no search, so the LIST shows everything
 *  (contacts.test.ts's "%" case). */
function searchParts(search: string | undefined): { s: string; plan: ContactSearchPlan } | null {
  const s = search ? sanitizeSearchTerm(search) : "";
  if (!search || !s) return null;
  return { s, plan: contactSearchPlan(search) };
}

/** public.contacts_matching's named arguments (0110). An absent part is ABSENT (the function's defaults), never
 *  null and never an empty array; `p_tokens` and `p_phone_keys` are text[] written as a PostgreSQL array literal
 *  with every element quoted: see `contactMatchArgs`. */
export type ContactMatchArgs = {
  p_account_id: string; p_text: string; p_tokens?: string; p_phone_keys?: string; p_national?: string;
};

/** `{"a","b"}`: a text[] literal with every element double-quoted, so a word that is an array-input keyword (null,
 *  in any case) stays a word. Only for elements that are [a-z0-9]+ (a folded word) or digits (a key), which hold no
 *  quote or backslash to escape; anything else throws rather than build a literal that could mean something else. */
function quotedTextArray(values: string[]): string {
  for (const v of values) if (!/^[a-z0-9]+$/.test(v)) throw new Error(`quotedTextArray: unexpected element ${JSON.stringify(v)}`);
  return `{${values.map((v) => `"${v}"`).join(",")}}`;
}

/**
 * F-092 scale follow-up (spec 4.4, plan T6): the arguments for public.contacts_matching (0110), or null exactly
 * when `contactSearchFilter` is null (no search: the reader stays on `from("contacts")`). Built from the same
 * sanitized text and plan: the text for the four raw arms; the folded words for search_name; the new phone key and
 * today's kept key, the present ones, for phone_key; the national ten for phone_national.
 *
 * Every reader calls it as a GET (or a HEAD for the count), so postgrest-js puts these in the URL: it drops an
 * `undefined`, writes `null` as the STRING "null" (which the matcher refuses, 22023, or reads as a malformed array),
 * and writes an array as `{a,b}` with nothing quoted (@supabase/postgrest-js 2.110.8, rpc()). Hence a missing part
 * is left out, an empty array is left out too (the default is the same `{}`), and the two array parts are sent as a
 * literal written here, every element quoted: in a bare `{a,b}` the word null is a NULL ELEMENT, so the search
 * "null" (a real word; the name "Null") was refused and failed (found by contact-search-live.test.ts on the replica).
 */
export function contactMatchArgs(accountId: string, search: string | undefined): ContactMatchArgs | null {
  const parts = searchParts(search);
  if (!parts) return null;
  const { s, plan } = parts;
  const keys = [plan.phone?.key, plan.keptKey].filter((k): k is string => typeof k === "string" && k !== "");
  const national = plan.phone?.national;
  return {
    p_account_id: accountId,
    p_text: s,
    ...(plan.tokens.length > 0 ? { p_tokens: quotedTextArray(plan.tokens) } : {}),
    ...(keys.length > 0 ? { p_phone_keys: quotedTextArray(keys) } : {}),
    ...(national ? { p_national: national } : {}),
  };
}

/**
 * The rows a contact read starts from: `from("contacts")` when there is no search, else the contacts the search
 * matches, through public.contacts_matching (0110) called as a GET. A GET passes the arguments as plain parameters,
 * which is what lets PostgreSQL inline the function into the statement, so the caller's eq, or, order and limit
 * reach contacts and its indexes directly (a POST is not inlined; spec 3.6). The function returns
 * `setof public.contacts` under the caller's RLS, so the row type is the table's and every filter after this is the
 * one an unsearched read applies. Its matcher answers every matching row of the account the caller may see
 * (archived, merged-away and holding records included): the account, holding, archive, merge and assignee rules
 * stay the caller's, outside, exactly as before.
 */
function contactRows(db: SupabaseClient, accountId: string, search: string | undefined) {
  const table = () => db.from("contacts").select(COLS);
  const args = contactMatchArgs(accountId, search);
  if (!args) return table();
  return db.rpc("contacts_matching", args, { get: true }).select(COLS) as unknown as ReturnType<typeof table>;
}

/** `contactRows` for a header total: the same source, as a HEAD with an exact count and no body. */
function contactCount(db: SupabaseClient, accountId: string, search: string | undefined) {
  const table = () => db.from("contacts").select("id", { count: "exact", head: true });
  const args = contactMatchArgs(accountId, search);
  if (!args) return table();
  return db.rpc("contacts_matching", args, { head: true, count: "exact" }) as unknown as ReturnType<typeof table>;
}

// Exported for its own pure, DB-free test (contacts-phone.test.ts) — not
// barrelled through index.ts, which is the public @bis/db surface; this is
// an internal search-building helper, not part of that contract. F-092: the
// new key (plan correction 8: "+1 956 55" now gives 95655, not 195655).
export function phoneSearchDigits(raw: string): string {
  return contactSearchPlan(raw).phone?.key ?? "";
}

/**
 * Mine/Unassigned (spec §8): the one place in the package that decides what
 * "mine" vs "unassigned" means on a PostgREST query — `column` names where
 * the assignee lives on THIS query: the bare `assigned_to` column here and
 * in `openTasks` (work-queue.ts), or `contacts.assigned_to` through an
 * `!inner` embed in `listConversations` (messaging.ts) and the other two
 * work-queue.ts readers. One implementation means the ternary that decides
 * mine vs unassigned can never drift between the four call sites.
 */
export function withAssigneeOn<T>(q: T, assignee: AssigneeFilter | undefined, column: string): T {
  if (!assignee) return q;
  const f = q as unknown as { eq: (c: string, v: string) => T; is: (c: string, v: null) => T };
  return assignee.who === "mine" ? f.eq(column, assignee.userId) : f.is(column, null);
}

/** `withAssigneeOn` pinned to this table's own column — what `listContacts`
 *  and `countContacts` both apply, so the list's rows and its header total
 *  can never disagree about which contacts the filter admits. */
function withAssignee<T>(q: T, assignee: AssigneeFilter | undefined): T {
  return withAssigneeOn(q, assignee, "assigned_to");
}

/** Contact archive (0103; owner rulings 2026-10-28). One rule for the list's rows and its header total, as
 *  withAssignee is: "exclude" (the list, search, pickers, export) or "only" (the Archived view) — and never
 *  a merged-away record (0106), in either view. */
export type ArchivedFilter = "exclude" | "only";
function withArchived<T>(q: T, archived: ArchivedFilter | undefined): T {
  const f = q as unknown as {
    is: (c: string, v: null) => T & { is: (c: string, v: null) => T };
    not: (c: string, op: string, v: null) => T & { is: (c: string, v: null) => T };
  };
  return (archived === "only" ? f.not("archived_at", "is", null) : f.is("archived_at", null)).is("merged_into", null);
}

export async function listContacts(
  db: SupabaseClient, accountId: string,
  opts: {
    search?: string; limit?: number; before?: ContactCursor; sort?: ContactSort; assignee?: AssigneeFilter;
    archived?: ArchivedFilter;
  } = {},
) {
  const sort: ContactSort = opts.sort ?? { key: "created", dir: "desc" };
  const column = SORT_COLUMN[sort.key];
  const ascending = sort.dir === "asc";

  // S-47e (spec 5.12.4, S29): a shared number's holding record is not a customer; the list never shows it.
  // F-092 scale (0110): a search reads through the matcher (contactRows); everything after the source is unchanged.
  let q = contactRows(db, accountId, opts.search).eq("account_id", accountId).eq("holds_shared_number", false)
    // Two-key ordering: the sort column alone is not unique — two contacts
    // can share a name or a company, and a CSV import (Task 6) writes
    // thousands of rows in the same created_at millisecond — so id breaks
    // the tie and makes the cursor below total (every row has a strict
    // position). `nullsFirst: false` keeps a nameless/company-less contact
    // LAST regardless of direction (0030's own design); it is a no-op for
    // `created_at`, which is `not null`, so this needs no per-key branch.
    .order(column, { ascending, nullsFirst: false })
    .order("id", { ascending })
    .limit(opts.limit ?? 50);
  q = withAssignee(q, opts.assignee);
  q = withArchived(q, opts.archived);
  if (opts.before) {
    const { v, id } = opts.before;
    const cmp = ascending ? "gt" : "lt";
    if (v === null) {
      // Already inside the null block (only reachable when this column is
      // nullable) — every remaining row has a null sort column too, so only
      // the id tiebreaker advances.
      q = q.or(`and(${column}.is.null,id.${cmp}.${id})`);
    } else {
      // Row-value comparison: everything strictly past (column, id) in the
      // ordering above, expressed as PostgREST's `or` of the two cases —
      // `v` is quoted (see quoteFilterValue) because it is now free text,
      // never re-derived or round-tripped through anything that could
      // reshape it, so it still matches the stored value exactly.
      const value = quoteFilterValue(v);
      const clause = `${column}.${cmp}.${value},and(${column}.eq.${value},id.${cmp}.${id})`;
      // Nullable columns: the remaining rows are the strictly-greater/lesser
      // non-nulls PLUS every null — nulls sort last in BOTH directions, so
      // they are still "not yet shown" the moment `v` is a real value.
      q = q.or(SORT_NULLABLE[sort.key] ? `${clause},${column}.is.null` : clause);
    }
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

export async function getContact(db: SupabaseClient, accountId: string, contactId: string) {
  const { data, error } = await db.from("contacts").select(COLS)
    .eq("account_id", accountId).eq("id", contactId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Review (D-008 round-trip): the CSV export's "tags" column comma-joins a
 * contact's tag names (`listTagNamesForContacts`), and the importer's
 * `splitTags` (lib/contacts/csv.ts) comma-SPLITS that same column back
 * apart — a tag name that itself contains a comma ("smith, john") exports
 * fine but re-imports as two tags, silently inventing one that was never
 * created. Chosen fix: refuse the comma at creation, not quote/escape it
 * on export — tag names are short labels, not sentences, and this keeps
 * the export/import contract (one plain comma-joined column) unchanged
 * for every other reader of it, rather than teaching the importer a
 * quoting rule it does not otherwise need. A stripped comma can leave
 * extra whitespace behind ("smith, john" → "smith john"), which the
 * surrounding `.trim()` only catches at the ends — an inner double space
 * is cosmetic, not a round-trip hazard, so it is left alone.
 */
function normalizeTagName(tagName: string): string {
  return tagName.replace(/,/g, "").trim().toLowerCase();
}

export async function addTagToContact(
  db: SupabaseClient, accountId: string, contactId: string, tagName: string,
): Promise<void> {
  const name = normalizeTagName(tagName);
  if (!name) return;
  const { data: tag, error: tErr } = await db.from("tags")
    .upsert({ account_id: accountId, name }, { onConflict: "account_id,name" })
    .select("id").single();
  if (tErr || !tag) throw new Error(`tag upsert failed: ${tErr?.message}`);
  const { error } = await db.from("contact_tags")
    .upsert({ contact_id: contactId, tag_id: tag.id, account_id: accountId },
            { onConflict: "contact_id,tag_id" });
  if (error) throw new Error(`contact_tags upsert failed: ${error.message}`);
}

export async function removeTagFromContact(
  db: SupabaseClient, accountId: string, contactId: string, tagId: string,
): Promise<void> {
  const { error } = await db.from("contact_tags").delete()
    .eq("account_id", accountId).eq("contact_id", contactId).eq("tag_id", tagId);
  if (error) throw new Error(error.message);
}

export async function listContactTags(db: SupabaseClient, accountId: string, contactId: string) {
  const { data, error } = await db.from("contact_tags")
    .select("tag_id, tags(id, name)").eq("account_id", accountId).eq("contact_id", contactId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ id: r.tags.id as string, name: r.tags.name as string }));
}

/**
 * Dashboard KPI tile: total contacts on the account, right now. `opts` is
 * optional so the dashboard's existing two-argument call keeps compiling
 * untouched; the contacts list (Task 3) passes `search` so its "N results"
 * caption counts what the filter matches, not the whole account.
 */
export async function countContacts(
  db: SupabaseClient, accountId: string,
  opts: { search?: string; assignee?: AssigneeFilter; archived?: ArchivedFilter } = {},
): Promise<number> {
  // S-47e: the same holding skip as listContacts, so the header total and the rows agree. F-092 scale (0110): the
  // same source as listContacts too (contactCount, the matcher for a search), so rows and total share one match rule.
  let q = contactCount(db, accountId, opts.search)
    .eq("account_id", accountId).eq("holds_shared_number", false);
  q = withAssignee(q, opts.assignee);
  // 0103: the same archive rule as listContacts, so the header total and the rows agree in both views.
  q = withArchived(q, opts.archived);
  const { count, error, status, statusText } = await q;
  if (error) throw new Error(`countContacts failed: ${countFailureReason(error, status, statusText)}`);
  if (count === null) throw new Error("countContacts failed: no count returned");
  return count;
}

/** A count is a HEAD request: a refused one has no body, so postgrest-js reports `{ message: "" }` and the only
 *  reason left is the response's status. Name the status always, the code when there is one, the message last. */
function countFailureReason(error: { message?: string; code?: string }, status: number, statusText: string): string {
  const http = `HTTP ${status}${statusText ? ` ${statusText}` : ""}`;
  const head = error.code ? `${http}, code ${error.code}` : http;
  return error.message ? `${head}: ${error.message}` : head;
}

type ContactListRow = NonNullable<Awaited<ReturnType<typeof listContacts>>>[number];

/**
 * F-092 part 1 (spec 5, owner ruling Q3): the small boxes (⌘K, the relationship picker, Add job, held email) show
 * the best match first; the contact list keeps its own chosen sort and paging (`listContacts`). Three tiers, each
 * the list's own match set (since 0110 the matcher, public.contacts_matching with `contactMatchArgs`, as the list
 * reads it; `contactSearchFilter` is its oracle), so a box never finds anyone the list would not, plus:
 *   1. exact: the folded words ARE the whole search name, or the national ten is the whole number, or the email
 *      key is the whole email;
 *   2. every word starts a word of the search name (one `or` per word, so they AND);
 *   3. contains: the match set alone.
 * Each ordered by sort_name then id and limited, merged in tier order, each person once, cut to `limit`. The
 * same holding, archive and merge rules as listContacts. Any tier's error throws: a shorter list would read as
 * fewer matches, not as a failed read. Runs on whatever client it is handed: callers pass the request client.
 *
 * Known limit (T1 review): a word joined by & or _ loses its boundary in the fold ("Smith&Sons" is stored as
 * "smithsons"), so tier 2 does not see "sons" start a word there; tier 3 still finds it.
 */
export async function searchContacts(
  db: SupabaseClient, accountId: string, opts: { term: string; limit: number },
): Promise<ContactListRow[]> {
  // F-092 scale (0110, plan T6): every tier reads the matcher's match set (contactRows, a GET), where it read
  // from("contacts") plus the list's .or(filter); tiers 1 and 2 still narrow it with their own or().
  if (!contactMatchArgs(accountId, opts.term)) return [];
  const plan = contactSearchPlan(opts.term);
  const base = () => withArchived(
    contactRows(db, accountId, opts.term).eq("account_id", accountId).eq("holds_shared_number", false)
      .order("sort_name", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(opts.limit),
    "exclude",
  );
  const exact: string[] = [];
  // Tokens are [a-z0-9]+ joined by one space (nameFold): no PostgREST grammar to quote.
  if (plan.tokens.length) exact.push(`search_name.eq.${plan.tokens.join(" ")}`);
  const digits = opts.term.replace(/[^0-9]/g, "");
  if (plan.phone && digits.length >= 10) {
    const n = phoneNational(digits);
    if (n !== null && n.length === 10) exact.push(`phone_national.eq.${n}`);
  }
  if (opts.term.includes("@")) exact.push(`email_key.eq.${quoteFilterValue(emailKey(opts.term))}`);
  const tiers = [
    exact.length ? base().or(exact.join(",")) : null,
    plan.tokens.length
      ? plan.tokens.reduce((q, t) => q.or(`search_name.ilike.${t}%,search_name.ilike.% ${t}%`), base())
      : null,
    base(),
  ];
  const answers = await Promise.all(tiers.map((q) => q ?? Promise.resolve({ data: [] as ContactListRow[], error: null })));
  const seen = new Set<string>();
  const out: ContactListRow[] = [];
  for (const { data, error } of answers) {
    if (error) throw new Error(`searchContacts failed: ${error.message}`);
    for (const row of (data ?? []) as ContactListRow[]) {
      if (!seen.has(row.id)) { seen.add(row.id); out.push(row); }
    }
  }
  return out.slice(0, opts.limit);
}

/**
 * Bulk tag: one tag upsert + one contact_tags bulk upsert. Same
 * trim/lowercase normalization as addTagToContact so "VIP" and "vip"
 * are the same tag. Returns the tagId so the caller can offer undo.
 */
export async function addTagToContacts(
  db: SupabaseClient, accountId: string, contactIds: string[], tagName: string,
): Promise<{ tagId: string; applied: number; addedIds: string[] }> {
  const name = normalizeTagName(tagName);
  if (!name || contactIds.length === 0) throw new Error("addTagToContacts: nothing to do");
  const { data: tag, error: tErr } = await db.from("tags")
    .upsert({ account_id: accountId, name }, { onConflict: "account_id,name" })
    .select("id").single();
  if (tErr || !tag) throw new Error(`tag upsert failed: ${tErr?.message}`);
  // D-007: a bulk tag's Undo must strip the tag only from contacts that did
  // NOT already carry it — never the whole original selection, or Undo
  // removes it from contacts that had it before this call too. Read who
  // already has it BEFORE the upsert below adds it to everyone, so the
  // caller (bulk-action-bar.tsx's Undo toast) can pass `addedIds` instead of
  // the full `contactIds`.
  //
  // NOT TRANSACTIONAL, noted rather than fixed here: the pre-read and the
  // upsert below are two separate round trips, so a second bulk-tag of the
  // SAME tag onto an overlapping selection, racing in between, could read
  // stale "already had it" data and report an id as newly-added when the
  // other request's upsert got there first (or vice versa) — Undo would
  // then strip a tag the other request's own Undo also owns, or leave one
  // on a contact that should have lost it. Accepted for this bulk-action
  // UI (one operator, one browser tab, a toast-click undo a few seconds
  // later) rather than wrapped in a transaction or `select ... for update`.
  const { data: already, error: alreadyErr } = await db.from("contact_tags")
    .select("contact_id").eq("account_id", accountId).eq("tag_id", tag.id).in("contact_id", contactIds);
  if (alreadyErr) throw new Error(`contact_tags pre-read failed: ${alreadyErr.message}`);
  const alreadyHad = new Set((already ?? []).map((r: { contact_id: string }) => r.contact_id));
  const addedIds = contactIds.filter((id) => !alreadyHad.has(id));
  const rows = contactIds.map((contactId) => ({
    contact_id: contactId, tag_id: tag.id, account_id: accountId,
  }));
  const { error } = await db.from("contact_tags")
    .upsert(rows, { onConflict: "contact_id,tag_id" });
  if (error) throw new Error(`contact_tags bulk upsert failed: ${error.message}`);
  return { tagId: tag.id, applied: contactIds.length, addedIds };
}

/** Undo for addTagToContacts: strip ONE tag from the same id set. */
export async function removeTagFromContacts(
  db: SupabaseClient, accountId: string, contactIds: string[], tagId: string,
): Promise<void> {
  if (contactIds.length === 0) return;
  const { error } = await db.from("contact_tags").delete()
    .eq("account_id", accountId).eq("tag_id", tagId).in("contact_id", contactIds);
  if (error) throw new Error(error.message);
}

/**
 * One `.in("contact_id", …)` batch's worth of ids. Review finding (first
 * pass at this function): the export route hands this a whole 500-row
 * chunk, and a single `.in()` with 400-500 UUIDs (~37 chars each) built a
 * request URL long enough that `fetch` itself threw — `TypeError: fetch
 * failed`, not a Postgres or RLS error — which the export's own
 * `controller.error` then turned into an aborted download for an account
 * that used to export fine (with a blank tags column) before D-008. 200
 * UUIDs is a safely short URL in every environment this runs in; chosen
 * conservatively rather than measured to the exact limit, since the cost of
 * one more round trip per chunk is negligible next to a failed export.
 */
const TAG_LOOKUP_BATCH_SIZE = 200;

/**
 * Every tag name for each of `contactIds`, as one comma-joined, alphabetized
 * string per contact — `lib/contacts/csv.ts`'s own `splitTags` delimiter, so
 * the CSV export's "tags" column round-trips through re-import unchanged
 * (D-008: that column used to be hard-coded blank because no bulk read
 * existed — only `listContactTags`, one contact at a time, which an export
 * of thousands of rows cannot afford as an N+1). BATCHED, not one query for
 * however many ids the caller names (see `TAG_LOOKUP_BATCH_SIZE`'s own
 * comment). A contactId with no tags is simply ABSENT from the returned
 * map, never an empty-string entry, so `.get(id) ?? ""` at the call site is
 * the only place "no tags" turns into a blank cell.
 */
export async function listTagNamesForContacts(
  db: SupabaseClient, accountId: string, contactIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (contactIds.length === 0) return result;
  const byContact = new Map<string, string[]>();
  for (let i = 0; i < contactIds.length; i += TAG_LOOKUP_BATCH_SIZE) {
    const batch = contactIds.slice(i, i + TAG_LOOKUP_BATCH_SIZE);
    const { data, error } = await db.from("contact_tags")
      .select("contact_id, tags(name)")
      .eq("account_id", accountId)
      .in("contact_id", batch);
    if (error) throw new Error(`listTagNamesForContacts failed: ${error.message}`);
    // Same `any` shape `listContactTags` above already uses for this exact
    // one-row-per-tag join: the generic `SupabaseClient` type (no generated
    // Database schema) infers a nested `tags(...)` select as an array, but a
    // `contact_tags` row carries exactly one `tag_id`, so the real value at
    // runtime is a single object (proven by this function's own db test
    // against the real database, not merely asserted here).
    for (const row of (data ?? []) as any[]) {
      const name = row.tags?.name as string | undefined;
      if (!name) continue;
      const names = byContact.get(row.contact_id) ?? [];
      names.push(name);
      byContact.set(row.contact_id, names);
    }
  }
  for (const [contactId, names] of byContact) {
    result.set(contactId, [...names].sort().join(","));
  }
  return result;
}

/** The account's tag vocabulary, for pickers. Alphabetical. */
export async function listTags(
  db: SupabaseClient, accountId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db.from("tags")
    .select("id, name").eq("account_id", accountId).order("name");
  if (error) throw new Error(`listTags failed: ${error.message}`);
  return (data ?? []) as { id: string; name: string }[];
}

/** At most this many contacts in one archive, restore, blockers read or delete: 0103's own cap on
 *  contact_delete_blockers and delete_internal_contacts (between 0 and 500 ids), applied to all four so the
 *  bulk bar's selection limit is one number. Refused BEFORE any query. */
export const MAX_CONTACT_BATCH = 500;
function capBatch(ids: readonly string[], fn: string): void {
  if (ids.length > MAX_CONTACT_BATCH) throw new Error(`${fn}: at most ${MAX_CONTACT_BATCH} contacts at once`);
}
/** At most this many ids in one `.in()` (review M1): TAG_LOOKUP_BATCH_SIZE's limit (see its own comment), the
 *  size assignment.ts's ASSIGN_IN_BATCH_SIZE settled on too. RPC arguments travel in the body and are not
 *  split. */
function inBatches<T>(ids: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += TAG_LOOKUP_BATCH_SIZE) out.push(ids.slice(i, i + TAG_LOOKUP_BATCH_SIZE));
  return out;
}

/** A multi-batch archive or restore that failed partway (fix round, 2026-10-28). The batches before the failure
 *  were committed, one statement each, so those contacts DID change: `changedIds` names them, so the caller can
 *  still offer Undo for exactly these (and refresh the list) instead of losing them behind the throw. */
export class ContactBatchError extends Error {
  readonly changedIds: string[];
  constructor(message: string, changedIds: string[]) {
    super(message);
    this.name = "ContactBatchError";
    this.changedIds = changedIds;
  }
}

/**
 * Delete for good, internal-only contacts (0103; spec §5; owner rulings 2026-10-28). A contact any customer
 * fact touches (a non-note message, an inbound email, a call, a form, a consent event, a sent automation, a
 * booking or a deal; `DELETE_BLOCK_REASONS`) is never deleted: it is archive-only, and it comes back in
 * `skippedIds`. Calls, forms, consent and sent automations block for the first time: their FKs are SET NULL,
 * so the old direct delete orphaned them rather than stopping. Deliberately NO event emit: `contact.deleted`
 * is not a curated ledger type and the ledger fails closed on unknown types.
 *
 * The order (spec §5.3) is load-bearing:
 * 1. The proof (review I1): only ids THIS client reads as this account's contacts go on. The ids come from the
 *    browser, and `beforeDelete` hands them to a service-role purge, so a filter there alone is not enough; on
 *    a request client RLS decides this read.
 * 1b. The Owner pre-flight (fix round): `delete_internal_contacts` with an EMPTY array on `db`. 0103 runs its
 *    Owner check before anything else and an empty array then deletes nothing (proven on the replica: an Owner
 *    and a service_role JWT get `{}`, Staff, another org's token and a claim-less token get 42501), so a
 *    caller the database would refuse is refused HERE, before the purge, never after the files are gone.
 * 2. `contact_delete_blockers` on `opts.serviceDb` (0103 step 7: service_role only, and definer, so a reason
 *    the caller's RLS hid can never read as no reason). One row per blocked contact, so 500 ids fit max_rows,
 *    and no messages row is ever read into this process (the 1001-message shape that misjudged a talked-to
 *    customer as empty before 0083 cannot recur).
 * 3. `beforeDelete` (the document vault's purge, 0077; owner ruling 2026-10-13: a customer's files go with
 *    them) runs on the unblocked ids ONLY, after every knowable blocker has been read. It is irreversible.
 *    The ids it could not clear are kept (`skippedFiles`).
 * 4. `delete_internal_contacts` on `db`, the REQUEST client, so 0103's Owner check decides (review I9): an
 *    Owner of this account, the agency, or a service_role JWT. It locks the contacts and their
 *    conversations, re-reads the blockers inside the lock, and deletes each contact in its own
 *    subtransaction with its note-only messages and its now-empty conversations. It answers the ids it
 *    deleted; an id it did not delete is `lateKept`.
 *
 * ACCEPTED residual (spec §5.3, not narrowed further): a contact that becomes blocked between step 2 and the
 * lock in step 4 (a text arrives), or keeps a file the purge left behind (documents_contact_fkey, NO ACTION,
 * caught per contact), is KEPT by step 4, and its files are already gone. It is counted in `lateKept` and
 * listed in `skippedIds`; the caller's `contacts.delete.filesGoneKept` line says exactly that. Narrowing it
 * would mean purging inside the lock, holding the contacts' row locks across a storage round trip.
 * `delete_empty_conversations` (0083) is no longer called here; a later migration drops it.
 */
export async function deleteContacts(
  db: SupabaseClient, accountId: string, contactIds: string[],
  opts: {
    /** The SERVICE client, for the blockers read only (0103 step 7, service_role only). The delete itself runs on
     *  `db`, the request client, so 0103's Owner check in delete_internal_contacts decides (review I9). */
    serviceDb: SupabaseClient;
    /** Runs on the deletable ids BEFORE any contact row is deleted; answers the ids it could not clear. The
     *  document vault's purge (0077). */
    beforeDelete?: (deletable: string[]) => Promise<string[]>;
  },
): Promise<{ deleted: number; skippedBlocked: number; skippedFiles: number; skippedIds: string[]; lateKept: number }> {
  capBatch(contactIds, "deleteContacts");
  const none = { deleted: 0, skippedBlocked: 0, skippedFiles: 0, skippedIds: [] as string[], lateKept: 0 };
  if (contactIds.length === 0) return none;
  const unique = [...new Set(contactIds)];
  // Step 1, the proof (review I1): only ids this client READS as this account's contacts go on.
  const ourSet = new Set<string>();
  for (const batch of inBatches(unique)) {
    const { data: mine, error: mineError } = await db.from("contacts").select("id")
      .eq("account_id", accountId).in("id", batch);
    if (mineError) throw new Error(`deleteContacts contacts pre-read failed: ${mineError.message}`);
    for (const r of mine ?? []) ourSet.add(r.id as string);
  }
  const ours = unique.filter((id) => ourSet.has(id));
  if (ours.length === 0) return none;
  // Step 1b: the database's own Owner check, before the service client reads anything and before any purge.
  const { error: ownerError } = await db.rpc("delete_internal_contacts", { p_account_id: accountId, p_contact_ids: [] });
  if (ownerError) throw new Error(`deleteContacts refused: ${ownerError.message}`);
  // Step 2: every knowable blocker, before anything irreversible runs.
  const blockers = await contactDeleteBlockers(opts.serviceDb, accountId, ours);
  const blocked = ours.filter((id) => blockers.has(id));
  const deletable = ours.filter((id) => !blockers.has(id));
  // Step 3: the purge, on the unblocked ids only.
  const kept = new Set(deletable.length > 0 && opts.beforeDelete ? await opts.beforeDelete(deletable) : []);
  const go = deletable.filter((id) => !kept.has(id));
  if (go.length === 0) return { ...none, skippedBlocked: blocked.length, skippedFiles: kept.size, skippedIds: blocked };
  // Step 4: on the REQUEST client, so the database's own Owner check decides.
  const { data, error } = await db.rpc("delete_internal_contacts", { p_account_id: accountId, p_contact_ids: go });
  if (error) throw new Error(`deleteContacts failed: ${error.message}`);
  const deleted = new Set((data ?? []) as string[]);
  // Blocked between the read and the lock (a text arrived), or a file the purge left: kept by the database.
  const late = go.filter((id) => !deleted.has(id));
  return {
    deleted: deleted.size, skippedBlocked: blocked.length + late.length, skippedFiles: kept.size,
    skippedIds: [...blocked, ...late], lateKept: late.length,
  };
}

/** Archive (0103): the request client, so RLS and the stamp trigger decide who may and who did (the trigger
 *  refuses a Technician and a shared number's holding record). Only rows that CHANGE come back, so an Undo
 *  restores exactly these and never one that was archived before (D-007's rule). A batch that fails throws
 *  ContactBatchError carrying the ids the earlier batches already archived.
 *  NOT a role check: a Technician's RLS hides an unassigned contact, so the update matches 0 rows with no
 *  error. The caller refuses Technicians by role first (seesWholeAccount). */
export async function archiveContacts(
  db: SupabaseClient, accountId: string, contactIds: string[],
): Promise<{ changedIds: string[] }> {
  capBatch(contactIds, "archiveContacts");
  const changedIds: string[] = [];
  for (const batch of inBatches(contactIds)) {
    const { data, error } = await db.from("contacts").update({ archived_at: new Date().toISOString() })
      .eq("account_id", accountId).in("id", batch)
      .eq("holds_shared_number", false).is("archived_at", null)
      .select("id");
    if (error) throw new ContactBatchError(`archiveContacts failed: ${error.message}`, changedIds);
    changedIds.push(...(data ?? []).map((r) => r.id as string));
  }
  return { changedIds };
}

/** Restore by hand (the Archived view, the record's banner, an Archive's Undo). Same shape as archiveContacts:
 *  only rows that were archived change, and only those come back. */
export async function restoreContacts(
  db: SupabaseClient, accountId: string, contactIds: string[],
): Promise<{ changedIds: string[] }> {
  capBatch(contactIds, "restoreContacts");
  const changedIds: string[] = [];
  for (const batch of inBatches(contactIds)) {
    const { data, error } = await db.from("contacts").update({ archived_at: null })
      .eq("account_id", accountId).in("id", batch).not("archived_at", "is", null)
      .select("id");
    if (error) throw new ContactBatchError(`restoreContacts failed: ${error.message}`, changedIds);
    changedIds.push(...(data ?? []).map((r) => r.id as string));
  }
  return { changedIds };
}

export const RESTORE_SIGNS = ["text", "email", "call", "booking", "form", "chat"] as const;
export type RestoreSign = (typeof RESTORE_SIGNS)[number];
/** Owner ruling Q1 (2026-10-28): the customer's own act brings an archived contact back to the list, with a
 *  "came back" row. The SERVICE client (0103 grants execute to service_role only). True when it restored.
 *  THROWS on a failure, and each caller decides. Every caller but one contains it in its own try, so a restore
 *  never costs the call, booking, form, chat or email it rides on. The SMS webhook deliberately rethrows on a FIRST filing (503, nothing filed, and
 *  Telnyx's retry redoes the whole text, restore included); on a repeat delivery it logs and goes on, so the
 *  consent step still runs. */
export async function restoreContactOnSign(
  serviceDb: SupabaseClient, accountId: string, contactId: string, sign: RestoreSign,
): Promise<boolean> {
  const { data, error } = await serviceDb.rpc("restore_contact_on_sign",
    { p_account_id: accountId, p_contact_id: contactId, p_sign: sign });
  if (error) throw new Error(`restoreContactOnSign failed: ${error.message}`);
  return data === true;
}

export const DELETE_BLOCK_REASONS = ["messages", "inbound_email", "calls", "forms", "consent", "automations", "bookings", "deals", "merges"] as const;
export type DeleteBlockReason = (typeof DELETE_BLOCK_REASONS)[number];
/** What keeps each contact from being deleted for good (spec §5.1), on the SERVICE client, for ids the caller
 *  already proved on its own client. One row per blocked contact (0103 step 7), so the answer fits max_rows.
 *  A contact with nothing in its way is absent from the map. */
export async function contactDeleteBlockers(
  serviceDb: SupabaseClient, accountId: string, contactIds: string[],
): Promise<Map<string, DeleteBlockReason[]>> {
  capBatch(contactIds, "contactDeleteBlockers");
  const out = new Map<string, DeleteBlockReason[]>();
  if (contactIds.length === 0) return out;
  const { data, error } = await serviceDb.rpc("contact_delete_blockers", { p_account_id: accountId, p_contact_ids: contactIds });
  if (error) throw new Error(`contactDeleteBlockers failed: ${error.message}`);
  // Never `data ?? []`: a null answer read as "nothing blocks" would send a talked-to customer to the purge.
  if (!Array.isArray(data)) throw new Error("contactDeleteBlockers failed: no answer");
  for (const r of data as { contact_id: string; reasons: DeleteBlockReason[] }[]) out.set(r.contact_id, r.reasons);
  return out;
}

/**
 * F-009's flag for one contact (0054): true when its stored phone's country
 * is unknown and texts are held until a person picks it. A missing contact
 * reads false: there is nothing to hold. THROWS on a read error; the send
 * gate turns that into `blocked: ledger_unavailable` (it fails closed).
 */
export async function readPhoneCountryFlag(db: SupabaseClient, accountId: string, contactId: string): Promise<boolean> {
  const { data, error } = await db.from("contacts").select("phone_country_unconfirmed")
    .eq("account_id", accountId).eq("id", contactId).maybeSingle();
  if (error) throw new Error(`readPhoneCountryFlag failed: ${error.message}`);
  return (data as { phone_country_unconfirmed: boolean } | null)?.phone_country_unconfirmed === true;
}

/**
 * The contact drawer's "Mexico (+52)" / "US (+1)" (F-009, spec §6): writes
 * `phone` and `phone_country_unconfirmed` together, ONLY while the stored
 * phone is still `expectedPhone` — a concurrent edit to the number wins and
 * this answers "changed". The undo is the same call with the two phones
 * swapped and the flag set again.
 *
 * A number that becomes some OTHER contact's (the flagged "+1 551…" picked as
 * "+52 551…" when a Mexican caller's contact already holds +52 551…) is still
 * written — the operator's answer is the truth about this row — and the pair
 * goes onto contact_duplicate_flags (reason 'phone_country_pick'), the queue a
 * merge tool reads. phone_key is not unique, so nothing refuses the write.
 */
export async function setContactPhoneCountry(
  db: SupabaseClient, accountId: string, contactId: string,
  input: { expectedPhone: string | null; phone: string | null; unconfirmed: boolean },
  actorId: string, actorType: ActorType = "user",
): Promise<"updated" | "changed"> {
  // `expectedPhone: null` (the inline Undo restoring a number a CLEAR wiped)
  // needs `.is(...)`: PostgREST's `eq.null` never matches a NULL column.
  let q = db.from("contacts")
    .update({ phone: input.phone, phone_country_unconfirmed: input.unconfirmed, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", contactId);
  q = input.expectedPhone === null ? q.is("phone", null) : q.eq("phone", input.expectedPhone);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`setContactPhoneCountry failed: ${error.message}`);
  if (!data?.length) return "changed";

  // Nothing to dedupe a CLEARED number against (round 4: the inline Undo
  // can restore a null phone — the first-fill case, undone).
  if (input.phone !== null) {
    // S-47e (spec 5.12.3; Task 4 review I1): a shared number's holding record is never a pick's twin.
    // 0106: nor is a merged-away record — the database's own trigger already filed this pair the moment
    // the phone column above was written, if there was anything to file.
    const { data: twins, error: twinErr } = await db.from("contacts").select("id")
      .eq("account_id", accountId).eq("holds_shared_number", false)
      .eq("phone_key", phoneDigits(input.phone)).neq("id", contactId).is("merged_into", null).limit(1);
    // The phone is written: a failure from here on is logged, never thrown
    // (a throw would report a failed pick that succeeded; review R3-M11).
    const twin = twinErr ? undefined : (twins ?? [])[0] as { id: string } | undefined;
    if (twinErr) console.error(`setContactPhoneCountry: duplicate check for account ${accountId} failed after the write: code ${twinErr.code ?? "none"}`);
    if (twin) await flagDuplicatePair(db, accountId, contactId, twin.id, "phone_country_pick");
  }
  await emit(db, accountId, "contact.updated", actorId,
    { contactId, fields: ["phone", "phone_country_unconfirmed"] }, actorType);
  return "updated";
}

// ---------------------------------------------------------------------------
// S-09: a language on every contact (migration 0076). The automatic writer is the SQL function
// `record_language_signal` (service role only: it sets the language only while it is null, so a
// staff choice is never overwritten). The staff writers below run on the SERVICE client, after the
// server action proved the contact on the caller's own client (getContact under RLS): the client role
// holds no UPDATE on these columns.
// ---------------------------------------------------------------------------
export type ContactLanguage = "en" | "es";
export type LanguageSource = "booking" | "form" | "call" | "staff";
export type LanguageSignalSource = Exclude<LanguageSource, "staff">;
/** contacts.language, its source and when it was set: all three null, or all three set (0076). */
export type LanguageTriple = { language: ContactLanguage | null; source: LanguageSource | null; setAt: string | null };
export const LANGUAGE_SOURCES: readonly LanguageSource[] = ["booking", "form", "call", "staff"];

/** The shape 0076's coherence check accepts, checked before a write so a forged Undo payload is refused here. */
export function isLanguageTriple(v: unknown): v is LanguageTriple {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  if (t.language === null && t.source === null && t.setAt === null) return true;
  return (t.language === "en" || t.language === "es")
    && typeof t.source === "string" && (LANGUAGE_SOURCES as readonly string[]).includes(t.source)
    && typeof t.setAt === "string" && Number.isFinite(Date.parse(t.setAt));
}

/**
 * One customer sign (S-09 §7.1): records it as the contact's last sign and sets the language when it
 * has none. Emits `contact.language_set` with the caller's actor ONLY when this call set the language.
 * Throws on an rpc error; every caller wraps it in its own try (a sign must never cost a booking, a
 * form or a call). An emit failure AFTER the rpc set the language is logged, never thrown (M-3).
 */
export async function recordLanguageSignal(
  db: SupabaseClient, accountId: string, contactId: string,
  signal: { language: ContactLanguage; source: LanguageSignalSource; at: Date | string },
  actorId: string, actorType: ActorType,
): Promise<boolean> {
  const at = typeof signal.at === "string" ? signal.at : signal.at.toISOString();
  const { data, error } = await db.rpc("record_language_signal", {
    p_account: accountId, p_contact: contactId, p_language: signal.language, p_source: signal.source, p_at: at,
  });
  if (error) throw new Error(`recordLanguageSignal failed: ${error.message}`);
  if (data !== true) return false;
  // Review M-3 (R3-M11, as restoreContactLanguage below): the rpc has COMMITTED the language by now,
  // so an emit failure is logged, never thrown — a throw would report a failed sign that landed.
  try {
    await emit(db, accountId, "contact.language_set", actorId,
      { contactId, language: signal.language, source: signal.source }, actorType);
  } catch (e) {
    console.error(`recordLanguageSignal: account ${accountId} contact ${contactId}: event emit failed after the rpc committed: ${(e as Error).message}`);
  }
  return true;
}

async function writeLanguage(
  db: SupabaseClient, accountId: string, contactId: string, patch: Record<string, string | null>,
): Promise<boolean> {
  const { data, error } = await db.from("contacts").update({ ...patch, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", contactId).select("id");
  if (error) throw new Error(`contact language write failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * A staff choice (S-09 §7.5): `staff`, now. `wrote` is false when the contact is not in this
 * account; `setAt` is the exact timestamp this call wrote (even when `wrote` is false, so a caller
 * never needs a read-back just to learn what it would have been — only a `wrote: true` result
 * means it actually landed).
 */
export async function setContactLanguage(
  db: SupabaseClient, accountId: string, contactId: string, language: ContactLanguage, actorId: string,
): Promise<{ wrote: boolean; setAt: string }> {
  const setAt = new Date().toISOString();
  const wrote = await writeLanguage(db, accountId, contactId,
    { language, language_source: "staff", language_set_at: setAt });
  if (wrote) await emit(db, accountId, "contact.language_set", actorId, { contactId, language, source: "staff" }, "user");
  return { wrote, setAt };
}

/** What the Undo must still find in the row before it is honoured, or stale (`"changed"`). */
export type LanguageRestoreOutcome = "updated" | "changed";

/**
 * Undo (C9, fix round I3): the prior triple back EXACTLY, only while the row still holds `written` —
 * the SAME compare-and-set every other Undo in this file runs (`setContactPhoneCountry`'s
 * `expectedPhone`): the UPDATE's own WHERE clause matches `written`'s language, source and
 * timestamp, so a row changed since the Undo was issued updates zero rows and answers "changed"
 * atomically, with no separate read-then-write race. A forged `written` (the caller's own claim of
 * what was there, sent back from the browser) that names the wrong language, source or timestamp
 * can therefore never match a real row either, for the same reason a stale one cannot.
 *
 * M1 (this file's own rule, R3-M11 above: a failure AFTER the write it is about has succeeded is
 * logged, never thrown — a throw here would report a failed Undo for a write that landed): the row
 * has already committed by the time `emit` runs below.
 */
export async function restoreContactLanguage(
  db: SupabaseClient, accountId: string, contactId: string,
  prior: LanguageTriple, written: LanguageTriple, actorId: string,
): Promise<LanguageRestoreOutcome> {
  if (!isLanguageTriple(prior) || !isLanguageTriple(written)) {
    throw new Error("restoreContactLanguage: not a language triple");
  }
  let q = db.from("contacts").update({
    language: prior.language, language_source: prior.source, language_set_at: prior.setAt,
    updated_at: new Date().toISOString(),
  }).eq("account_id", accountId).eq("id", contactId);
  q = written.language === null ? q.is("language", null) : q.eq("language", written.language);
  q = written.source === null ? q.is("language_source", null) : q.eq("language_source", written.source);
  q = written.setAt === null ? q.is("language_set_at", null) : q.eq("language_set_at", written.setAt);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`contact language write failed: ${error.message}`);
  if (!data?.length) return "changed";
  try {
    await emit(db, accountId, "contact.language_set", actorId,
      { contactId, language: prior.language, source: prior.source, undo: true }, "user");
  } catch (e) {
    console.error(`restoreContactLanguage: account ${accountId} contact ${contactId}: event emit failed after the write committed: ${(e as Error).message}`);
  }
  return "updated";
}

/** Keep (§7.4): the hint stays away until a newer sign. Nothing about the customer changes. */
export async function keepContactLanguageHint(
  db: SupabaseClient, accountId: string, contactId: string, actorId: string,
): Promise<boolean> {
  const { data, error } = await db.from("contacts").update({ language_hint_kept_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", contactId).select("id");
  if (error) throw new Error(`keepContactLanguageHint failed: ${error.message}`);
  const wrote = (data ?? []).length > 0;
  if (wrote) await emit(db, accountId, "contact.language_hint_kept", actorId, { contactId }, "user");
  return wrote;
}
