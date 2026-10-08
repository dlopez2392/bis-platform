import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { sanitizeSearchTerm } from "./search-term";
import { normalisePhone } from "./phone";

export type ContactInput = {
  firstName?: string; lastName?: string; email?: string; phone?: string;
  companyName?: string; source?: string; custom?: Record<string, unknown>;
};

// `sort_name` (0030, a stored generated column) rides along on every read —
// not just when sorting by name — because the caller building the NEXT
// cursor (apps/web's contacts/page.tsx) needs whichever column the CURRENT
// sort used off the last row, and that is cheapest to guarantee by always
// selecting it rather than conditionally shaping this string per sort key.
//
// `marketing_email_opted_out_at` (0049) is no longer read (consent PR-3): the
// email stop lives in the ledger, and a later migration drops the column.
const COLS =
  "id, first_name, last_name, email, phone, company_name, source, custom, created_at, updated_at, sort_name, phone_country_unconfirmed";

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
  if (input.companyName !== undefined) row.company_name = input.companyName;
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
 */
async function findDuplicate(
  db: SupabaseClient, accountId: string, email?: string, phone?: string,
): Promise<DuplicateMatch> {
  const result: DuplicateMatch = { emailMatch: null, phoneMatch: null, countryTwin: null };

  const eKey = email ? emailKey(email) : "";
  if (eKey) {
    const { data, error } = await db.from("contacts").select("id")
      .eq("account_id", accountId).eq("email_key", eKey).limit(1);
    if (error) throw new Error(`contact dedupe failed: ${error.message}`);
    if (data && data.length > 0) result.emailMatch = data[0]!.id as string;
  }

  const pKey = phone ? phoneKeyOf(phone) : "";
  if (pKey) {
    const { data, error } = await db.from("contacts").select("id")
      .eq("account_id", accountId).eq("phone_key", pKey).limit(1);
    if (error) throw new Error(`contact dedupe failed: ${error.message}`);
    if (data && data.length > 0) result.phoneMatch = data[0]!.id as string;

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
    if (!result.phoneMatch && /^52\d{10}$/.test(pKey)) {
      legacyTenDigits = pKey.slice(2);
      legacyKeys = [legacyTenDigits, `521${legacyTenDigits}`];
    } else if (!result.phoneMatch && /^\d{10}$/.test(pKey) && phone === `+1${pKey}`) {
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
      const { data: bare, error: bareErr } = await db.from("contacts").select("id, phone")
        .eq("account_id", accountId).in("phone_key", legacyKeys).limit(10);
      if (bareErr) throw new Error(`contact dedupe failed: ${bareErr.message}`);
      const hits = (bare ?? []) as { id: string; phone: string | null }[];
      const bareHit = hits.find((h) =>
        h.phone !== null && (hasNoCountryMarker(h.phone) || normalisePhone(h.phone)?.e164 === `+${pKey}`));
      if (bareHit) result.phoneMatch = bareHit.id;
      else if (hits[0]) result.countryTwin = hits[0].id;
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

export async function createContact(
  db: SupabaseClient, accountId: string, input: ContactInput, actorId: string,
  actorType: ActorType = "user",
): Promise<{ id: string; existing: boolean; flagged: boolean }> {
  const email = input.email?.trim().toLowerCase();
  // The phone as it will be STORED, so the event names what the row holds.
  const phone = phoneFields(input.phone).phone ?? undefined;
  const match = await findDuplicate(db, accountId, email || undefined, phone);
  const winner = match.emailMatch ?? match.phoneMatch;

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
    const { error } = await db.from("contact_duplicate_flags")
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
    flagged = (await flagDuplicatePair(db, accountId, winner, match.countryTwin, "phone_country_twin")) || flagged;
  }
  if (winner) return { id: winner, existing: true, flagged };

  const { data, error } = await db.from("contacts")
    .insert({ account_id: accountId, ...toRow(input) }).select("id").single();
  if (error || !data) throw new Error(`createContact failed: ${error?.message}`);
  await emit(db, accountId, "contact.created", actorId, { contactId: data.id, email, phone },
    actorType);
  const twinFlagged = match.countryTwin !== null
    && await flagDuplicatePair(db, accountId, data.id, match.countryTwin, "phone_country_twin");
  return { id: data.id, existing: false, flagged: twinFlagged };
}

export async function updateContact(
  db: SupabaseClient, accountId: string, contactId: string,
  input: Partial<ContactInput>, actorId: string,
  actorType: ActorType = "user",
): Promise<void> {
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
  const { error } = await db.from("contacts")
    .update({ ...toRow(input, currentPhone), updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", contactId);
  if (error) throw new Error(`updateContact failed: ${error.message}`);
  await emit(db, accountId, "contact.updated", actorId, { contactId, fields: Object.keys(input) },
    actorType);
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
  const row = await getContact(db, accountId, contactId);
  if (!row) throw new Error("fillContactBlanks: no such contact");
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
  if (filled.length === 0) return [];
  // The phone is stored as every write stores it, with its country flag —
  // and that flag is a column this call actually writes, so it belongs in
  // the reported/emitted field list too (review m7), not just in `written`.
  const written = "phone" in patch ? { ...patch, ...phoneFields(String(patch.phone)) } : patch;
  const reportedFields = "phone" in patch ? [...filled, "phone_country_unconfirmed"] : filled;

  const { error } = await db.from("contacts")
    .update({ ...written, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", contactId);
  if (error) throw new Error(`fillContactBlanks failed: ${error.message}`);
  await emit(db, accountId, "contact.updated", actorId, { contactId, fields: reportedFields }, actorType);
  return reportedFields;
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
 * Applies the shared name/email/phone search filter, or returns `q` unchanged.
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
 * GATED ON THE TERM LOOKING LIKE A PHONE (`phoneSearchDigits` below), not
 * merely on having any digit in it at all — review finding (first pass):
 * "maria5@example.com" or "Suite 9" each carry one digit, and an
 * unconditional `phone_key.ilike.%5%`/`%9%` matched almost every contact
 * with a phone containing that digit, turning a name/email search into a
 * near-random phone hit via `.or()`'s union. Shape AND a 4-digit floor
 * (field-input.ts's own `PHONE_CHARS`, reused rather than re-declared) are
 * both required: a term built entirely of phone punctuation and digits,
 * with enough of them that a short, common digit run ("2026", a year
 * someone types in an unrelated note) can't alone light up every phone
 * ending the same way by accident.
 */
const PHONE_SEARCH_SHAPE = /^[+()\-. \d]+$/;
const MIN_PHONE_SEARCH_DIGITS = 4;

// Exported for its own pure, DB-free test (contacts-phone.test.ts) — not
// barrelled through index.ts, which is the public @bis/db surface; this is
// an internal search-building helper, not part of that contract.
export function phoneSearchDigits(raw: string): string {
  if (!PHONE_SEARCH_SHAPE.test(raw)) return "";
  const digits = phoneDigits(raw);
  return digits.length >= MIN_PHONE_SEARCH_DIGITS ? digits.slice(0, 20) : "";
}

function withSearch<T>(q: T, search?: string): T {
  const s = search ? sanitizeSearchTerm(search) : undefined;
  if (!s) return q;
  const clauses = [
    `first_name.ilike.%${s}%`, `last_name.ilike.%${s}%`,
    `email.ilike.%${s}%`, `phone.ilike.%${s}%`,
  ];
  const digits = search ? phoneSearchDigits(search) : "";
  if (digits) clauses.push(`phone_key.ilike.%${digits}%`);
  return (q as { or: (f: string) => T }).or(clauses.join(","));
}

export async function listContacts(
  db: SupabaseClient, accountId: string,
  opts: { search?: string; limit?: number; before?: ContactCursor; sort?: ContactSort } = {},
) {
  const sort: ContactSort = opts.sort ?? { key: "created", dir: "desc" };
  const column = SORT_COLUMN[sort.key];
  const ascending = sort.dir === "asc";

  let q = db.from("contacts").select(COLS).eq("account_id", accountId)
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
  q = withSearch(q, opts.search);
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
  db: SupabaseClient, accountId: string, opts: { search?: string } = {},
): Promise<number> {
  let q = db.from("contacts").select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
  q = withSearch(q, opts.search);
  const { count, error } = await q;
  if (error) throw new Error(`countContacts failed: ${error.message}`);
  return count ?? 0;
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

/**
 * Bulk delete with skip-blocked semantics. opportunities.contact_id and
 * conversations.contact_id are NO ACTION FKs, and bookings.contact_id is
 * `on delete restrict` BY DESIGN (0017) — a single unfiltered
 * `delete … in (…)` would abort the whole batch on one linked contact.
 * So: pre-read which ids have any blocking child, delete only the rest in
 * one statement, and report both counts honestly. contact_tags/notes/tasks
 * cascade; form_submissions and calls set-null (schema, not our concern
 * here). Deliberately NO event emit: `contact.deleted` is not a curated
 * ledger type and the ledger fails closed on unknown types.
 */
export async function deleteContacts(
  db: SupabaseClient, accountId: string, contactIds: string[],
): Promise<{ deleted: number; skippedBlocked: number }> {
  if (contactIds.length === 0) return { deleted: 0, skippedBlocked: 0 };
  const blocked = new Set<string>();
  for (const table of ["opportunities", "conversations", "bookings"] as const) {
    const { data, error } = await db.from(table).select("contact_id")
      .eq("account_id", accountId).in("contact_id", contactIds);
    if (error) throw new Error(`deleteContacts ${table} pre-read failed: ${error.message}`);
    for (const r of data ?? []) if (r.contact_id) blocked.add(r.contact_id as string);
  }
  const deletable = contactIds.filter((id) => !blocked.has(id));
  if (deletable.length === 0) return { deleted: 0, skippedBlocked: blocked.size };
  const { data, error } = await db.from("contacts").delete()
    .eq("account_id", accountId).in("id", deletable).select("id");
  if (error) throw new Error(`deleteContacts failed: ${error.message}`);
  return { deleted: (data ?? []).length, skippedBlocked: blocked.size };
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
    const { data: twins, error: twinErr } = await db.from("contacts").select("id")
      .eq("account_id", accountId).eq("phone_key", phoneDigits(input.phone)).neq("id", contactId).limit(1);
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
