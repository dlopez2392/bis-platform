import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { phoneFields, phoneKeyOf, createContact, updateContact, fillContactBlanks,
         setContactPhoneCountry, phoneDigits } from "./contacts";
import { applyImportBatch, type MatchIndex } from "./contact-import";

/**
 * F-009 on write (consent chain spec §4.1 item 1): every contact write
 * stores the normalised number and the flag together, and dedupes on the
 * key of what it WILL store. Pure; the live writes are CI-only
 * (src/test/contacts-phone-live.test.ts).
 */
describe("phoneFields", () => {
  it("a US number is stored as E.164, unflagged", () => {
    expect(phoneFields("(956) 292-1696")).toEqual({ phone: "+19562921696", phone_country_unconfirmed: false });
  });

  it("a plainly Mexican ten digits is stored as +52, unflagged (mutation: always +1 → FAILS)", () => {
    expect(phoneFields("899 922 1234")).toEqual({ phone: "+528999221234", phone_country_unconfirmed: false });
  });

  it("an ambiguous ten digits is stored as +1 AND flagged (mutation: drop the flag → FAILS)", () => {
    expect(phoneFields("55 1234 5678")).toEqual({ phone: "+15512345678", phone_country_unconfirmed: true });
  });

  it("what the normaliser cannot read is kept as typed, trimmed, unflagged — never dropped", () => {
    expect(phoneFields("  ext. 12  ")).toEqual({ phone: "ext. 12", phone_country_unconfirmed: false });
  });

  it("blank is null, unflagged", () => {
    expect(phoneFields("   ")).toEqual({ phone: null, phone_country_unconfirmed: false });
    expect(phoneFields(null)).toEqual({ phone: null, phone_country_unconfirmed: false });
  });
});

describe("phoneKeyOf — the dedupe key of the number as it will be stored", () => {
  it("a Mexican number keys on its +52 digits, so it does NOT collide with the same ten digits under +1 (mutation: key the raw digits → FAILS)", () => {
    expect(phoneKeyOf("899 922 1234")).toBe("528999221234");
    expect(phoneKeyOf("+1 899 922 1234")).not.toBe(phoneKeyOf("899 922 1234"));
  });

  it("the same US number spelled two ways keys the same", () => {
    expect(phoneKeyOf("(956) 292-1696")).toBe(phoneKeyOf("+19562921696"));
  });

  it("blank is the empty key", () => {
    expect(phoneKeyOf("")).toBe("");
    expect(phoneKeyOf(undefined)).toBe("");
  });
});

/**
 * Review R1-I3 / spec clarification / m3 / m4: 0033's phone_key is the
 * stored DIGITS, so a contact saved before F-009 as "899 922 1234" keys
 * 8999221234 while its +52 reading keys 528999221234, and one stored as
 * "+52 1 899 922 1234" keys 5218999221234 (the retired-mobile prefix, still
 * present because pre-F-009 writes never normalised anything). An in-memory
 * PostgREST stand-in is enough to drive createContact/updateContact/
 * fillContactBlanks/setContactPhoneCountry's dedupe and write paths; the
 * live path is test/contacts-phone-live.test.ts (CI).
 */
type Row = Record<string, unknown>;

// Every test that spies on console.error restores it here regardless of
// pass/fail — an assertion failure throws BEFORE a test's own
// `errSpy.mockRestore()` line runs, and vi.spyOn on an already-spied method
// reuses the same mock, so a failing probe's leftover spy would otherwise
// keep recording calls into whichever test runs next.
afterEach(() => {
  vi.restoreAllMocks();
});

function rowMatches(row: Row, filters: [string, unknown][]): boolean {
  return filters.every(([k, v]) => {
    if (k.startsWith("!")) return row[k.slice(1)] !== v;
    if (Array.isArray(v)) return v.includes(row[k]);
    return row[k] === v;
  });
}

function memoryDb(contacts: Row[]) {
  const tables: { contacts: Row[]; contact_duplicate_flags: Row[]; events: Row[]; tags: Row[] } & Record<string, Row[]> =
    { contacts, contact_duplicate_flags: [], events: [], tags: [] };
  let nextId = 1;
  /** Every READ, as the filters it was asked for: what a lookup must NOT ask is testable. */
  const reads: [string, unknown][][] = [];
  const db = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const readTerminal = (limitN?: number) => {
        reads.push([...filters]);
        const rows = tables[table]!.filter((r) => rowMatches(r, filters));
        return Promise.resolve({ data: limitN === undefined ? rows : rows.slice(0, limitN), error: null });
      };
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
        neq: (k: string, v: unknown) => { filters.push([`!${k}`, v]); return q; },
        in: (k: string, vals: unknown[]) => { filters.push([k, vals]); return q; },
        order: () => readTerminal(),
        limit: (n: number) => readTerminal(n),
        maybeSingle: () => {
          reads.push([...filters]);
          const rows = tables[table]!.filter((r) => rowMatches(r, filters));
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        insert: (row: Row) => {
          const stored: Row = { ...row, id: `new-${nextId++}` };
          if (table === "contacts") stored.phone_key = stored.phone ? phoneDigits(String(stored.phone)) : null;
          tables[table]!.push(stored);
          const done = Promise.resolve({ data: null, error: null });
          return Object.assign(done, { select: () => ({ single: () => Promise.resolve({ data: { id: stored.id }, error: null }) }) });
        },
        // A thenable: `await` alone (no `.select()`) resolves it directly —
        // both `updateContact` and `fillContactBlanks` do this — while
        // `.select(cols)` (setContactPhoneCountry) computes and returns the
        // matched ids instead. Either path applies the patch exactly once,
        // lazily, once every `.eq()`/`.neq()` has already run (they run
        // synchronously before anyone awaits this).
        update: (patch: Row) => {
          const uFilters: [string, unknown][] = [];
          const apply = () => {
            const rows = tables[table]!.filter((r) => rowMatches(r, uFilters));
            for (const r of rows) Object.assign(r, patch);
            return rows;
          };
          const chain: {
            eq: (k: string, v: unknown) => typeof chain;
            neq: (k: string, v: unknown) => typeof chain;
            select: (cols: string) => Promise<{ data: { id: unknown }[]; error: null }>;
            then: (resolve: (v: { data: null; error: null }) => void, reject?: (e: unknown) => void) => Promise<void>;
          } = {
            eq: (k, v) => { uFilters.push([k, v]); return chain; },
            neq: (k, v) => { uFilters.push([`!${k}`, v]); return chain; },
            select: (_cols: string) => Promise.resolve({ data: apply().map((r) => ({ id: r.id })), error: null }),
            then: (resolve, reject) => Promise.resolve({ data: null, error: null } as const)
              .then(() => { apply(); return { data: null, error: null } as const; })
              .then(resolve, reject),
          };
          return chain;
        },
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, tables, reads };
}

describe("createContact: a +52 number meets the contact stored before F-009 (review R1-I3)", () => {
  it("a contact stored as bare \"899 922 1234\" IS the new +52 write: no second contact (mutation: drop the bare-ten fallback → a duplicate is inserted, FAILS)", async () => {
    const m = memoryDb([{ id: "c-old", account_id: "a1", phone: "899 922 1234", phone_key: "8999221234" }]);
    expect(await createContact(m.db, "a1", { phone: "899-922-1234" }, "user_test")).toEqual({ id: "c-old", existing: true, flagged: false });
    expect(m.tables.contacts).toHaveLength(1);
  });

  it("the same ten digits stored as +1 are a country TWIN: a new contact, and the pair queued for the merge tool (mutation: treat the twin as the same contact → FAILS)", async () => {
    const m = memoryDb([{ id: "c-us", account_id: "a1", phone: "+18999221234", phone_key: "8999221234" }]);
    const created = await createContact(m.db, "a1", { phone: "899 922 1234" }, "user_test");
    expect(created).toMatchObject({ existing: false, flagged: true });
    expect(m.tables.contacts.find((r) => r.id === created.id)).toMatchObject({ phone: "+528999221234", phone_country_unconfirmed: false });
    expect(m.tables.contact_duplicate_flags).toEqual([expect.objectContaining({
      account_id: "a1", contact_a: [created.id, "c-us"].sort()[0], contact_b: [created.id, "c-us"].sort()[1], reason: "phone_country_twin",
    })]);
  });

  it("a +52 contact already stored as +52 is found by its own key, with no fallback read (mutation: run the fallback even after a hit → a second read, FAILS)", async () => {
    const m = memoryDb([{ id: "c-mx", account_id: "a1", phone: "+528999221234", phone_key: "528999221234" }]);
    expect(await createContact(m.db, "a1", { phone: "899 922 1234" }, "user_test")).toMatchObject({ id: "c-mx", existing: true });
    expect(m.reads.map((r) => r.find(([k]) => k === "phone_key")?.[1])).toEqual(["528999221234"]);
  });

  // M3 (review): mirror of the +52 case directly above, for the +1 side of
  // the new symmetric branch — a +1 contact found by its own primary key
  // must not ALSO run the bare-ten-digit fallback read. Before this test
  // existed, dropping `!result.phoneMatch &&` from that branch's condition
  // passed every other test in this file.
  it("a +1 contact already stored as +1 is found by its own key, with no fallback read (M3; mutation: drop `!result.phoneMatch &&` from the bare-ten-digit branch → a second read, FAILS)", async () => {
    const m = memoryDb([{ id: "c-us", account_id: "a1", phone: "+19562921696", phone_key: "9562921696" }]);
    expect(await createContact(m.db, "a1", { phone: "(956) 292-1696" }, "user_test")).toMatchObject({ id: "c-us", existing: true });
    expect(m.reads.map((r) => r.find(([k]) => k === "phone_key")?.[1])).toEqual(["9562921696"]);
  });

  // Was "a +1 number never takes the +52 fallback": that pinned the exact
  // one-directional bug this follow-up fixes. A +1 number's key is always
  // the bare ten digits (phoneDigits strips the leading NANP "1"), which is
  // indistinguishable in shape from a legacy bare-stored number OR a
  // Mexican one with its "52" stripped — so it now takes the SAME symmetric
  // fallback the +52 branch always has, checking the 52-/521-prefixed MX
  // legacy shapes on those ten digits. On an empty account that fallback
  // read happens and simply finds nothing.
  it("a +1 number also takes the fallback, checking for an MX-keyed twin on the same ten digits (symmetric with the +52 case above; mutation: drop the /^\\d{10}$/ branch → no second read, FAILS)", async () => {
    const n = memoryDb([]);
    expect(await createContact(n.db, "a1", { phone: "(956) 292-1696" }, "user_test")).toMatchObject({ existing: false, flagged: false });
    expect(n.reads.map((r) => r.find(([k]) => k === "phone_key")?.[1])).toEqual([
      "9562921696",
      ["529562921696", "5219562921696"],
    ]);
  });

  // I1 (review): the bare-ten-digit branch's whole point is a TEN-digit
  // key — a non-NANP, non-Mexican number (a UK number here) never gets that
  // short, and must never take the fallback read at all. Before this test
  // existed, mutating the branch's guard from `/^\d{10}$/.test(pKey)` to
  // nothing (just `!result.phoneMatch`) passed every other test in this
  // file: the fallback ran unconditionally and this test is the only one
  // that notices the extra read on a key that was never ten digits.
  it("a number that is neither North American nor Mexican never takes the fallback — exactly one phone_key read (I1; mutation: `} else if (!result.phoneMatch && /^\\d{10}$/.test(pKey)) {` → `} else if (!result.phoneMatch) {` → a second read, FAILS)", async () => {
    const n = memoryDb([]);
    expect(await createContact(n.db, "a1", { phone: "+44 20 7946 0958" }, "user_test")).toMatchObject({ existing: false, flagged: false });
    expect(n.reads.map((r) => r.find(([k]) => k === "phone_key")?.[1])).toEqual(["442079460958"]);
  });

  // M6 (review): narrows the bare-ten-digit branch to an incoming number
  // that reads as a FIRM +1 claim, not any arbitrary typed text that merely
  // keys to ten digits. "0123456789" is refused outright by normalisePhone
  // (a leading 0 is never a real NANP/MX number), so phoneFields keeps it
  // as typed, unflagged, and its phone_key is simply its own ten digits —
  // without the `phone === "+1" + pKey` guard this would still take the
  // fallback and queue a spurious twin flag against any contact that merely
  // shares those digits under an explicit +52.
  it("the bare-ten-digit fallback never fires for typed text that only coincidentally keys to ten digits, with no firm +1 reading behind it (M6; mutation: drop the `phone === \\`+1${pKey}\\`` guard → a spurious twin flag, FAILS)", async () => {
    const m = memoryDb([{ id: "c-mx", account_id: "a1", phone: "+520123456789", phone_key: "520123456789" }]);
    const created = await createContact(m.db, "a1", { phone: "0123456789" }, "user_test");
    expect(created).toMatchObject({ existing: false, flagged: false });
    expect(m.tables.contact_duplicate_flags).toHaveLength(0);
    expect(m.reads.map((r) => r.find(([k]) => k === "phone_key")?.[1])).toEqual(["0123456789"]);
  });

  it("an EMAIL match still queues the country twin its +52 number found (re-review minor 12; mutation: return the email match without the flag → FAILS)", async () => {
    const m = memoryDb([
      { id: "c-email", account_id: "a1", email_key: "ana@example.com", phone: null, phone_key: null },
      { id: "c-us", account_id: "a1", phone: "+18999221234", phone_key: "8999221234" },
    ]);
    expect(await createContact(m.db, "a1", { email: "ana@example.com", phone: "899 922 1234" }, "user_test"))
      .toEqual({ id: "c-email", existing: true, flagged: true });
    expect(m.tables.contact_duplicate_flags).toEqual([expect.objectContaining({
      contact_a: "c-email", contact_b: "c-us", reason: "phone_country_twin",
    })]);
  });

  it("an email match that is also its own country twin is never flagged against itself (review m6; mutation: drop the countryTwin !== winner guard → a self-pair, FAILS)", async () => {
    const m = memoryDb([
      { id: "c1", account_id: "a1", email_key: "x@example.com", phone: "+18999221234", phone_key: "8999221234" },
    ]);
    const created = await createContact(m.db, "a1", { email: "x@example.com", phone: "899 922 1234" }, "user_test");
    expect(created).toEqual({ id: "c1", existing: true, flagged: false });
    expect(m.tables.contact_duplicate_flags).toHaveLength(0);
  });

  /**
   * The reverse of "the same ten digits stored as +1 are a country TWIN"
   * above: a +52 contact already on file, then a NEW contact arrives whose
   * number unambiguously reads as +1 with the SAME ten digits. findDuplicate
   * only ever special-cased an INCOMING +52 key (the `/^52\d{10}$/` guard),
   * so this direction found nothing at all — not even a flag — and a second,
   * undetected duplicate contact was created silently. Followed up from
   * PR #151 (893f0bc4's note: "+52 after +1 flags; +1 after +52 doesn't").
   */
  it("the same ten digits stored as +52 ARE a country twin when the new number reads as +1 (symmetric with the +1-then-+52 case above; mutation: drop the /^\\d{10}$/ branch → no flag, FAILS)", async () => {
    const m = memoryDb([{ id: "c-mx", account_id: "a1", phone: "+529562921696", phone_key: "529562921696" }]);
    const created = await createContact(m.db, "a1", { phone: "(956) 292-1696" }, "user_test");
    expect(created).toMatchObject({ existing: false, flagged: true });
    expect(m.tables.contacts.find((r) => r.id === created.id)).toMatchObject({ phone: "+19562921696" });
    expect(m.tables.contact_duplicate_flags).toEqual([expect.objectContaining({
      account_id: "a1", contact_a: [created.id, "c-mx"].sort()[0], contact_b: [created.id, "c-mx"].sort()[1], reason: "phone_country_twin",
    })]);
  });
});

describe("findDuplicate's fallback: spec clarification (bare-stored is the SAME contact, however its digits read today), m3 and m4", () => {
  it("an AMBIGUOUS bare-stored number is the SAME contact once a +52 read of it arrives — a behaviour change from the plan's original reading, which flagged it as a twin (mutation: keep the old normalisePhone(hit.phone) e164 equality check → a twin instead of a merge, FAILS)", async () => {
    // Stored bare, pre-F-009: "55 1234 5678" alone reads as ambiguous (+1,
    // unconfirmed) — but the spec says a BARE stored number is this contact
    // regardless of how it reads today; it just hasn't been told its
    // country yet.
    const m = memoryDb([{ id: "c-bare", account_id: "a1", phone: "55 1234 5678", phone_key: "5512345678" }]);
    const result = await createContact(m.db, "a1", { phone: "+52 55 1234 5678" }, "user_test");
    expect(result).toEqual({ id: "c-bare", existing: true, flagged: false });
    expect(m.tables.contacts).toHaveLength(1);
  });

  it("with a bare contact and a +1 contact sharing the same ten digits, the bare (same) contact wins regardless of read order (review m3; mutation: limit(1) with no preference → a third contact when the +1 row is fetched first, FAILS)", async () => {
    // The +1-stored row is seeded FIRST specifically to prove order doesn't
    // decide the outcome: only whether a row carries an explicit "+" does.
    const m = memoryDb([
      { id: "c-us-first", account_id: "a1", phone: "+18999221234", phone_key: "8999221234" },
      { id: "c-bare-second", account_id: "a1", phone: "899 922 1234", phone_key: "8999221234" },
    ]);
    const result = await createContact(m.db, "a1", { phone: "899 922 1234" }, "user_test");
    expect(result).toEqual({ id: "c-bare-second", existing: true, flagged: false });
    expect(m.tables.contacts).toHaveLength(2); // no third contact minted
  });

  it("a contact stored as the retired-mobile-prefixed form (521…) is found by the 521 key too — previously a SILENT duplicate, found by neither the primary nor the bare-ten lookup (review m4; mutation: look up only the bare ten-digit key → a duplicate is inserted, FAILS)", async () => {
    const m = memoryDb([{ id: "c-521", account_id: "a1", phone: "52 1 899 922 1234", phone_key: "5218999221234" }]);
    const result = await createContact(m.db, "a1", { phone: "899 922 1234" }, "user_test");
    expect(result).toEqual({ id: "c-521", existing: true, flagged: false });
    expect(m.tables.contacts).toHaveLength(1);
  });

  it("every dedupe read is scoped to the account — a foreign account's contact never matches (review I4; mutation: drop `.eq('account_id', …)` from any dedupe read → a cross-account contact leaks in, FAILS)", async () => {
    const m = memoryDb([
      { id: "c-a2-bare", account_id: "a2", phone: "899 922 1234", phone_key: "8999221234" },
    ]);
    const result = await createContact(m.db, "a1", { phone: "899 922 1234" }, "user_test");
    expect(result.existing).toBe(false); // a1 must NOT match a2's contact
    for (const read of m.reads) {
      expect(read).toEqual(expect.arrayContaining([["account_id", "a1"]]));
    }
  });

  it("a contact stored WITH an explicit + that reads as the SAME +52 number merges (re-review; mutation: decide by the raw '+' shape instead of what it reads as → a twin instead of a merge, FAILS)", async () => {
    // "+52 1 899 922 1234" carries a "+" — the old shape-only rule called
    // this a twin — but it reads as the exact same +528999221234 the
    // incoming number does, so it must merge.
    const m = memoryDb([{ id: "c-521-plus", account_id: "a1", phone: "+52 1 899 922 1234", phone_key: "5218999221234" }]);
    const result = await createContact(m.db, "a1", { phone: "899 922 1234" }, "user_test");
    expect(result).toEqual({ id: "c-521-plus", existing: true, flagged: false });
    expect(m.tables.contacts).toHaveLength(1);
  });

  it("a contact stored WITHOUT a + but that reads as a firm +1 claim is a TWIN, not a merge (re-review; mutation: decide by the raw '+' shape instead of what it reads as → wrongly merged, FAILS)", async () => {
    // "1 (899) 922-1234" has NO "+" — the old shape-only rule called this
    // bare and merged it — but its leading "1" is an explicit NANP marker:
    // it reads as +18999221234, a firm US claim, so it must be a twin, the
    // same as the already-correct "+1 899 922 1234" case.
    const m = memoryDb([{ id: "c-nanp-noplus", account_id: "a1", phone: "1 (899) 922-1234", phone_key: "8999221234" }]);
    const result = await createContact(m.db, "a1", { phone: "899 922 1234" }, "user_test");
    expect(result).toMatchObject({ existing: false, flagged: true });
    expect(m.tables.contacts).toHaveLength(2);
    expect(m.tables.contact_duplicate_flags).toHaveLength(1);
  });

  it("flagDuplicatePair's own failure log carries only the Postgres error CODE, never the message (review M8a; mutation: log the message too → FAILS)", async () => {
    const m = memoryDb([{ id: "c-us", account_id: "a1", phone: "+18999221234", phone_key: "8999221234" }]);
    const realFrom = (m.db as unknown as { from: (t: string) => unknown }).from.bind(m.db);
    (m.db as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      if (table === "contact_duplicate_flags") {
        return { insert: () => Promise.resolve({ error: { code: "42P01", message: "a customer's private detail that must never be logged" } }) };
      }
      return realFrom(table);
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await createContact(m.db, "a1", { phone: "899 922 1234" }, "user_test");
    expect(errSpy).toHaveBeenCalledTimes(1);
    const [line] = errSpy.mock.calls[0]!;
    expect(String(line)).toContain("42P01");
    expect(String(line)).not.toContain("a customer's private detail");
  });
});

describe("updateContact: an unchanged number keeps its flag (review C1)", () => {
  it("re-writing the SAME E.164 leaves phone_country_unconfirmed untouched (mutation: drop the currentPhone comparison in toRow → the flag is cleared, FAILS)", async () => {
    const m = memoryDb([{ id: "c1", account_id: "a1", phone: "+15512345678", phone_key: "5512345678", phone_country_unconfirmed: true }]);
    await updateContact(m.db, "a1", "c1", { phone: "+15512345678" }, "user_test");
    expect(m.tables.contacts[0]).toMatchObject({ phone: "+15512345678", phone_country_unconfirmed: true });
  });

  it("the SAME number typed differently ALSO keeps the flag (mutation: compare raw strings instead of normalised E.164 → a fresh recompute clobbers a false flag back to true, FAILS)", async () => {
    // The seeded flag (false) deliberately disagrees with what a FRESH
    // read of "(551) 234-5678" would compute (true, since 551/CDMX-55 is
    // ambiguous) — the only way this test can tell "preserved" apart from
    // "recomputed from scratch" is to seed a value fresh computation would
    // never itself produce.
    const m = memoryDb([{ id: "c1", account_id: "a1", phone: "+15512345678", phone_key: "5512345678", phone_country_unconfirmed: false }]);
    await updateContact(m.db, "a1", "c1", { phone: "(551) 234-5678" }, "user_test");
    expect(m.tables.contacts[0]).toMatchObject({ phone: "+15512345678", phone_country_unconfirmed: false });
  });

  it("a GENUINELY different number recomputes the flag from its own reading (mutation: always keep the old flag → FAILS)", async () => {
    const m = memoryDb([{ id: "c1", account_id: "a1", phone: "+15512345678", phone_key: "5512345678", phone_country_unconfirmed: true }]);
    await updateContact(m.db, "a1", "c1", { phone: "(956) 292-1696" }, "user_test");
    expect(m.tables.contacts[0]).toMatchObject({ phone: "+19562921696", phone_country_unconfirmed: false });
  });

  it.each([
    ["+1 (551) 234-5678"],
    ["1 (551) 234-5678"],
  ])("re-writing the same number back keeps the flag even when the STORED text is formatted, not pure E.164: %s (re-review C1; mutation: compare against the raw stored text instead of normalisePhone(currentPhone)?.e164 → the flag is cleared, FAILS)", async (stored) => {
    const m = memoryDb([{ id: "c1", account_id: "a1", phone: stored, phone_key: "5512345678", phone_country_unconfirmed: true }]);
    await updateContact(m.db, "a1", "c1", { phone: stored }, "user_test");
    // Unchanged writes NEITHER column (round-3 fix) — the stored TEXT stays
    // exactly as it was (never rewritten to pure E.164), and so does the flag.
    expect(m.tables.contacts[0]).toMatchObject({ phone: stored, phone_country_unconfirmed: true });
  });

  it.each([
    ["55 1234 5678"],
    ["+15512345678"],
  ])("an UNFLAGGED bare-stored number (written before this deploy, the backfill not yet run) re-saved with the same number is rewritten as NEITHER text nor flag — %s (mutation: write the normalised phone even when unchanged → the bare text becomes a confirmed-looking +1 number with the flag still false, FAILS)", async (incoming) => {
    // The gate re-derives a BARE stored number at send time (ambiguous means
    // held); a "+1…" text with an untouched false flag reads as already
    // confirmed and would be texted. So an unchanged number must leave the
    // stored bare text — and the stale false flag — exactly alone.
    const m = memoryDb([{ id: "c1", account_id: "a1", phone: "55 1234 5678", phone_key: "5512345678", phone_country_unconfirmed: false }]);
    await updateContact(m.db, "a1", "c1", { phone: incoming }, "user_test");
    expect(m.tables.contacts[0]).toMatchObject({ phone: "55 1234 5678", phone_country_unconfirmed: false });
  });
});

describe("updateContact: its own current-phone read fails closed and stays account-scoped (re-review N2, N3)", () => {
  it("the current-phone read is account-scoped (mutation: drop the account_id filter on that read → FAILS)", async () => {
    const m = memoryDb([{ id: "c1", account_id: "a1", phone: "+15512345678", phone_key: "5512345678", phone_country_unconfirmed: true }]);
    await updateContact(m.db, "a1", "c1", { phone: "+15512345678" }, "user_test");
    expect(m.reads.length).toBeGreaterThan(0);
    for (const read of m.reads) {
      expect(read).toEqual(expect.arrayContaining([["account_id", "a1"]]));
    }
  });

  it("a failed current-phone read aborts the write entirely — never fails open and writes anyway (mutation: swallow the read error instead of throwing → a write proceeds despite the failed check, FAILS)", async () => {
    const m = memoryDb([{ id: "c1", account_id: "a1", phone: "+15512345678", phone_key: "5512345678", phone_country_unconfirmed: true }]);
    const realFrom = (m.db as unknown as { from: (t: string) => unknown }).from.bind(m.db);
    let call = 0;
    (m.db as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      if (table === "contacts") {
        call++;
        if (call === 1) {
          return {
            select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { code: "53300", message: "too many connections" } }) }) }) }),
          };
        }
      }
      return realFrom(table);
    };
    await expect(updateContact(m.db, "a1", "c1", { phone: "(956) 292-1696" }, "user_test")).rejects.toThrow();
    // Unchanged — the failed check must have aborted the write, not just
    // failed to compare correctly.
    expect(m.tables.contacts[0]).toMatchObject({ phone: "+15512345678", phone_country_unconfirmed: true });
  });
});

describe("applyImportBatch: a CSV re-import of a flagged contact's own exported row keeps the flag (review C1)", () => {
  it("re-importing the unchanged exported phone does not clear phone_country_unconfirmed (mutation: revert updateContact's currentPhone check → the flag is cleared, FAILS)", async () => {
    const m = memoryDb([{ id: "c1", account_id: "a1", phone: "+15512345678", phone_key: "5512345678", phone_country_unconfirmed: true }]);
    const index: MatchIndex = { byEmail: new Map(), byPhone: new Map([["5512345678", "c1"]]) };
    const result = await applyImportBatch(m.db, "a1", [{ input: { phone: "+15512345678" }, tags: [] }], index, "user_test", { createTags: false });
    expect(result).toEqual({ created: 0, updated: 1, flagged: 0 });
    expect(m.tables.contacts[0]).toMatchObject({ phone: "+15512345678", phone_country_unconfirmed: true });
  });

  it.each([
    ["+1 (551) 234-5678"],
    ["1 (551) 234-5678"],
  ])("re-importing a row that matches a FORMATTED stored number (not pure E.164) keeps the flag: %s (re-review C1; mutation: compare against the raw stored text → the flag is cleared, FAILS)", async (stored) => {
    const m = memoryDb([{ id: "c1", account_id: "a1", phone: stored, phone_key: "5512345678", phone_country_unconfirmed: true }]);
    const index: MatchIndex = { byEmail: new Map(), byPhone: new Map([["5512345678", "c1"]]) };
    const result = await applyImportBatch(m.db, "a1", [{ input: { phone: stored }, tags: [] }], index, "user_test", { createTags: false });
    expect(result).toEqual({ created: 0, updated: 1, flagged: 0 });
    // Unchanged writes NEITHER column (round-3 fix) — the stored TEXT stays
    // exactly as it was.
    expect(m.tables.contacts[0]).toMatchObject({ phone: stored, phone_country_unconfirmed: true });
  });

  it.each([
    ["55 1234 5678"],
    ["+15512345678"],
  ])("re-importing an UNFLAGGED bare-stored contact's own number leaves the text and flag exactly alone — %s (mutation: write the normalised phone even when unchanged → the bare text becomes a confirmed-looking +1 number with the flag still false, FAILS)", async (incoming) => {
    const m = memoryDb([{ id: "c1", account_id: "a1", phone: "55 1234 5678", phone_key: "5512345678", phone_country_unconfirmed: false }]);
    const index: MatchIndex = { byEmail: new Map(), byPhone: new Map([["5512345678", "c1"]]) };
    const result = await applyImportBatch(m.db, "a1", [{ input: { phone: incoming }, tags: [] }], index, "user_test", { createTags: false });
    expect(result).toEqual({ created: 0, updated: 1, flagged: 0 });
    expect(m.tables.contacts[0]).toMatchObject({ phone: "55 1234 5678", phone_country_unconfirmed: false });
  });
});

describe("fillContactBlanks: the phone fill carries its own flag, reported and emitted (review I3, m7)", () => {
  it("fills a blank phone with its normalised reading AND sets the flag, and reports/emits phone_country_unconfirmed alongside phone (mutation: const written = patch; → FAILS)", async () => {
    const m = memoryDb([{ id: "c1", account_id: "a1", first_name: "Amb", last_name: null, email: null, phone: null }]);
    const filled = await fillContactBlanks(m.db, "a1", "c1", { phone: "55 1234 5678" }, "user_test");
    expect(filled).toEqual(["phone", "phone_country_unconfirmed"]);
    expect(m.tables.contacts[0]).toMatchObject({ phone: "+15512345678", phone_country_unconfirmed: true });
    expect(m.tables.events[0]).toMatchObject({ type: "contact.updated", payload: { fields: ["phone", "phone_country_unconfirmed"] } });
  });
});

describe("setContactPhoneCountry: fails closed on the twin check without ever undoing a successful pick (review m5)", () => {
  it("a phone-country pick never reports failure once the write succeeds, even when the twin check errors afterward (mutation: throw on the twin-lookup error instead of logging → FAILS)", async () => {
    const m = memoryDb([{ id: "c1", account_id: "a1", phone: "+15512345678", phone_key: "5512345678", phone_country_unconfirmed: true }]);
    // Break the twin lookup specifically by making its `.limit()` throw via
    // a poisoned filter value that the mock cannot satisfy safely — instead,
    // simplest: monkey-patch `from` for just the second call.
    let call = 0;
    const realFrom = (m.db as unknown as { from: (t: string) => unknown }).from.bind(m.db);
    (m.db as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      if (table === "contacts") {
        call++;
        if (call === 2) {
          return {
            select: () => ({
              eq: () => ({ eq: () => ({ neq: () => ({ limit: () => Promise.resolve({ data: null, error: { code: "53300", message: "too many connections" } }) }) }) }),
            }),
          };
        }
      }
      return realFrom(table);
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await setContactPhoneCountry(m.db, "a1", "c1",
      { expectedPhone: "+15512345678", phone: "+525512345678", unconfirmed: false }, "user_test");
    expect(result).toBe("updated");
    expect(errSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it("the twin-check failure log carries only the Postgres error CODE, never the message (review m5, minor 12; mutation: log the message too → FAILS)", async () => {
    const m = memoryDb([{ id: "c1", account_id: "a1", phone: "+15512345678", phone_key: "5512345678", phone_country_unconfirmed: true }]);
    let call = 0;
    const realFrom = (m.db as unknown as { from: (t: string) => unknown }).from.bind(m.db);
    (m.db as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      if (table === "contacts") {
        call++;
        if (call === 2) {
          return {
            select: () => ({
              eq: () => ({ eq: () => ({ neq: () => ({ limit: () => Promise.resolve({ data: null, error: { code: "42P01", message: "a customer's private detail that must never be logged" } }) }) }) }),
            }),
          };
        }
      }
      return realFrom(table);
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await setContactPhoneCountry(m.db, "a1", "c1",
      { expectedPhone: "+15512345678", phone: "+525512345678", unconfirmed: false }, "user_test");
    const [line] = errSpy.mock.calls[0]!;
    expect(String(line)).toContain("42P01");
    expect(String(line)).not.toContain("a customer's private detail");
    errSpy.mockRestore();
  });

  it("a repeat duplicate-flag insert (23505) is a silent, designed no-op — never thrown, never logged (review m5; mutation: treat 23505 like any other error → FAILS)", async () => {
    const m = memoryDb([
      { id: "c1", account_id: "a1", phone: "+15512345678", phone_key: "5512345678", phone_country_unconfirmed: true },
      { id: "c2", account_id: "a1", phone: "+525512345678", phone_key: "525512345678" },
    ]);
    let call = 0;
    const realFrom = (m.db as unknown as { from: (t: string) => unknown }).from.bind(m.db);
    (m.db as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      if (table === "contact_duplicate_flags") {
        call++;
        return { insert: () => Promise.resolve({ error: { code: "23505", message: "duplicate key value violates unique constraint" } }) };
      }
      return realFrom(table);
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await setContactPhoneCountry(m.db, "a1", "c1",
      { expectedPhone: "+15512345678", phone: "+525512345678", unconfirmed: false }, "user_test");
    expect(result).toBe("updated");
    expect(call).toBe(1); // the flag insert really was attempted
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
