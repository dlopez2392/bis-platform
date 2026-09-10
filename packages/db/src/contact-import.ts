import type { SupabaseClient } from "@supabase/supabase-js";
import { createContact, updateContact, addTagToContacts, listTags, phoneDigits,
         type ContactInput } from "./contacts";

/**
 * A snapshot of the account's email/phone -> contact id, built once per
 * import batch (never once per row) so a re-import of an exported file does
 * not re-pay `findDuplicate`'s O(n) phone-fallback scan for every UPDATE
 * row — see that function's own comment in contacts.ts for why the fallback
 * selects every non-null phone on the account and compares in memory.
 * `byEmail` keys are lowercased; `byPhone` keys go through the same exported
 * `phoneDigits` findDuplicate itself uses, so the two paths cannot drift onto
 * different definitions of "the same phone number".
 *
 * What this index does NOT do: remove that cost for a row that turns out to
 * be a CREATE. A miss still calls `createContact`, and `createContact` calls
 * `findDuplicate` internally — see `applyImportBatch`'s comment below for the
 * full reasoning; the short version is that the plan that specified this
 * index claimed it made the whole import avoid the O(n^2) scan, and that is
 * only true for rows that resolve to an update.
 */
export type MatchIndex = { byEmail: Map<string, string>; byPhone: Map<string, string> };

export async function buildMatchIndex(
  db: SupabaseClient, accountId: string,
): Promise<MatchIndex> {
  const { data, error } = await db.from("contacts").select("id, email, phone")
    .eq("account_id", accountId);
  if (error) throw new Error(`buildMatchIndex failed: ${error.message}`);
  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.email) byEmail.set(String(row.email).toLowerCase(), row.id as string);
    if (row.phone) {
      const key = phoneDigits(String(row.phone));
      if (key) byPhone.set(key, row.id as string);
    }
  }
  return { byEmail, byPhone };
}

/**
 * One CSV row, already mapped and validated by Task 5's `mapRows`. `tags` is
 * carried beside the patch rather than inside `input`: it is not a
 * `ContactInput` field, and keeping it separate is what makes the binding
 * below a structural guarantee rather than an accident of test coverage.
 */
export type ImportRow = { input: ContactInput; tags: string[] };

/**
 * Applies one import batch.
 *
 * For each row: look up email then phone in `index`. A hit calls
 * `updateContact` with the row's patch as given — Task 5 already dropped
 * every blank cell before it reached `input`, so a blank cell here can never
 * null out a column, and a present cell always overwrites (this is not
 * `fillContactBlanks`). A miss calls `createContact`.
 *
 * --- Trap 1 (plan defect, kept visible rather than silently "fixed") ---
 * The plan justifies this index by saying `findDuplicate`'s phone fallback
 * is "O(n^2) for an import" without it, implying the index removes that
 * cost. It only removes it for rows that resolve to an UPDATE. `createContact`
 * calls `findDuplicate` internally before every insert, so a row this index
 * has never seen before still pays that same account-wide scan inside
 * `createContact` — the index does not know about it and cannot prevent it.
 * Concretely: `findDuplicate`'s email branch returns early only on a HIT: a
 * row with an email AND a phone that misses this index's email check still
 * falls through to the phone branch, whose fallback fires unless the row's
 * raw phone string exactly matches an existing row's raw phone string — and
 * if it did, this index (built with the same `phoneDigits` function) would
 * already have matched it. So in practice, every CREATED row that carries a
 * phone number pays the full account-wide scan regardless of this index.
 *
 * Three ways to respond were on the table. Inventing a new public API (e.g.
 * a `createContact` variant that skips its own dedupe) is out of bounds by
 * this task's own rule. Inserting directly against the `contacts` table
 * would dodge the cost, but skips `toRow`'s column mapping and the
 * `contact.created` event — worse than the cost it would save, since those
 * exist for reasons unrelated to import. What is implemented here is the
 * third: call `createContact` as the plan's Step 3 prescribes, accept the
 * cost, and say so here instead of leaving the plan's stronger claim
 * standing next to code that does not deliver it. The cost is bounded and
 * one-sided: it is paid by CSV imports (an operator-initiated, infrequent,
 * already-slow-relative-to-a-page-load operation), not by any interactive
 * path, and only by rows that create a new contact with a phone number —
 * pure email-only creates, and every update, stay at the index's O(1).
 *
 * --- Trap 2 (silent-loss risk, not just a wrong count) ---
 * `createContact` can itself report `existing: true` — its own dedupe can
 * match something this index missed. Two things follow from that, not one:
 * counting every index-miss as `created` without reading the flag makes the
 * counts wrong (what the plan's own Step 3 prose does, verbatim), but there
 * is a second failure hiding behind the first. `createContact` returns
 * immediately on a duplicate WITHOUT writing anything — the row's fields are
 * never applied to that existing contact. Code that reads the flag only to
 * decide `created++` vs `updated++`, and then moves on, would silently drop
 * that row's data on the floor whenever this happens. So the `existing: true`
 * branch below gets the identical treatment as an index hit: it calls
 * `updateContact` with the row's patch before counting it, and only then
 * counts it as `updated`.
 *
 * --- Trap 3 (addTagToContacts upserts; createTags:false needs a real gate) ---
 * `addTagToContacts` creates an unknown tag name by upserting it — calling
 * it and hoping cannot enforce `createTags: false`. Tag names are resolved
 * against `listTags` ONCE per batch (never once per row, same "build once"
 * reasoning as `index`), lowercased to match how `addTagToContacts` itself
 * normalizes on write; an unrecognised name is carried through only when
 * `createTags` is true. `addTagToContacts` also throws on an empty
 * `contactIds` array or an empty tag name ("nothing to do") — an empty
 * string after trim is dropped before it can reach that call, and a tag
 * name's contact-id set is only ever created at the moment a first id is
 * about to be added to it, so every entry applied below is non-empty by
 * construction.
 *
 * --- THE BINDING ---
 * An empty `tags` array must never remove a tag. This function never calls
 * anything that removes a tag — the only tag-mutating call it ever makes is
 * the additive `addTagToContacts` — so `tags: []` is structurally incapable
 * of touching a contact's existing tags, not merely untested into doing so.
 */
export async function applyImportBatch(
  db: SupabaseClient, accountId: string, rows: ImportRow[], index: MatchIndex,
  actorId: string, opts: { createTags: boolean },
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  const known = new Set((await listTags(db, accountId)).map((t) => t.name.toLowerCase()));
  // tag name (already lowercased — the stored form) -> every contact id this
  // batch resolved for it. Applied once per distinct name after the row
  // loop, so a tag shared by many rows costs one addTagToContacts call, not N.
  const tagPlan = new Map<string, Set<string>>();

  for (const row of rows) {
    const email = row.input.email?.trim().toLowerCase() || undefined;
    const phoneKey = row.input.phone ? phoneDigits(row.input.phone.trim()) : "";
    const hitId = (email && index.byEmail.get(email)) ||
      (phoneKey && index.byPhone.get(phoneKey)) || undefined;

    let contactId: string;
    if (hitId) {
      await updateContact(db, accountId, hitId, row.input, actorId);
      contactId = hitId;
      updated++;
    } else {
      const result = await createContact(db, accountId, row.input, actorId);
      contactId = result.id;
      if (result.existing) {
        // Trap 2's second half: apply the row's fields exactly as an index
        // hit would, before counting — see the function comment above.
        await updateContact(db, accountId, contactId, row.input, actorId);
        updated++;
      } else {
        created++;
      }
      // Keep the index current so a LATER row in this same batch (or the
      // same file, for a caller re-using `index` across chunks) resolves in
      // one map lookup instead of another createContact/findDuplicate round
      // trip. See the mutation-check note in the test file for what this
      // line does and does not prove.
      if (email) index.byEmail.set(email, contactId);
      if (phoneKey) index.byPhone.set(phoneKey, contactId);
    }

    for (const raw of row.tags) {
      const name = raw.trim().toLowerCase();
      if (!name) continue; // never let an empty name reach addTagToContacts
      if (!known.has(name) && !opts.createTags) continue;
      if (!tagPlan.has(name)) tagPlan.set(name, new Set());
      tagPlan.get(name)!.add(contactId);
    }
  }

  for (const [name, contactIds] of tagPlan) {
    if (contactIds.size === 0) continue; // documents the invariant; see Trap 3
    await addTagToContacts(db, accountId, [...contactIds], name);
  }

  return { created, updated };
}
