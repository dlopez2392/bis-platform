import { describe, it, expect, vi } from "vitest";

/**
 * Reads per drawer open (S-03 part 3 §5): every from()/rpc() the route makes, through a stand-in for
 * supabase-js that answers each read empty (one row for the contact and the account), over the REAL
 * @bis/db readers and loaders. The count is a fence: a new read on this path fails it by name.
 * Measured on a customer with nothing yet; a customer with rows adds the person-names read and the
 * bookings' "Moved from" read (record.ts's listContactBookings), both bounded.
 */
type Read = { client: "request" | "ledger"; target: string };
const reads: Read[] = [];
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID = "22222222-2222-4222-8222-222222222222";
const SINGLE: Record<string, unknown> = {
  contacts: { id: CONTACT_ID, account_id: ACCOUNT_ID, first_name: "Maria", last_name: "Garcia", email: "maria@example.com", phone: "+19565550100",
    company_name: null, created_at: "2025-12-02T00:00:00Z", source: null, custom: {}, attribution: null, assigned_to: null,
    phone_country_unconfirmed: false },
  accounts: { timezone: "America/Chicago", language: null },
};
function recordingClient(client: Read["client"]) {
  const chain = (target: string) => {
    let single = false;
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") {
          const result = single ? { data: SINGLE[target] ?? null, error: null, count: 0 } : { data: [], error: null, count: 0 };
          return (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad);
        }
        return () => { if (prop === "maybeSingle" || prop === "single") single = true; return proxy; };
      },
    });
    return proxy;
  };
  return {
    from: (table: string) => { reads.push({ client, target: table }); return chain(table); },
    rpc: (fn: string) => { reads.push({ client, target: `rpc:${fn}` }); return chain(`rpc:${fn}`); },
  };
}
const request = recordingClient("request");
const ledger = recordingClient("ledger");
vi.mock("@/lib/auth", () => ({ apiAccountAccess: async () => ({ userId: "u1", isAgency: true }) }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => request }));
vi.mock("@/lib/consent/ledger-db", () => ({ ledgerDb: () => ledger }));
// Its own one-row read of the person's users row (its own client): counted by hand, +1.
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: null, theme: null }) }));
vi.mock("@/lib/zone", () => ({ renderZone: async (z?: string) => ({ zone: z ?? "UTC", guessed: !z, label: z ?? "UTC", source: "account" }) }));

const { GET } = await import("./route");

/** Set from the first run (Step 2) and dated; never raised without the report saying why. */
// Raised 22 -> 23 on 2026-10-13 by S-07 part 1 (the document vault): the drawer's five newest
// timeline rows include file rows like any timeline row, so the timeline reads `documents`
// (one bounded read, under RLS, which decides whether an Owners-only file shows). Still no
// Documents card in the drawer; that lives on the full record only.
// Raised 23 -> 24 on 2026-10-14 by S-07 part 1b (owner ruling R2): a new version of a file is its
// own timeline row, read from 0078's view document_version_timeline (security_invoker, so the same
// RLS decides), inside the same documents source.
// Raised 24 -> 25 on 2026-10-15 by S-07 part 2a (spec 3.5): a removed file is its own timeline row,
// read from 0079's view document_scan_timeline (security_invoker, so the same RLS decides), inside
// the same documents source.
// Raised 25 -> 26 on 2026-10-15 by S-07 part 2b (plan deviation 6): a request for files is its own
// timeline row, read from 0080's document_requests (under RLS), inside the same documents source.
const MEASURED = 26; // measured 2026-10-15: 26 reads (+1 prefs), the 26th is request:document_requests (S-07 2b); 25 before S-07 2b, the 25th request:document_scan_timeline; 24 before S-07 2a, 23 before S-07 1b, 22 before S-07, 20 with non-uuid fixture ids, 7 (+0) before S-03 part 3

describe("reads per drawer open (S-03 part 3 §5: measured, not assumed)", () => {
  it("the contact read first, the ledger only after it, and no more reads than measured (mutation: re-add the unpaged listContactMessages read -> FAILS)", async () => {
    const res = await GET(new Request(`http://x/api/accounts/${ACCOUNT_ID}/contacts/${CONTACT_ID}/summary`), { params: Promise.resolve({ accountId: ACCOUNT_ID, contactId: CONTACT_ID }) });
    expect(res.status).toBe(200);
    const list = reads.map((r) => `${r.client}:${r.target}`);
    console.info(`drawer reads per open: ${reads.length} through the clients, +1 getPersonPrefs\n${list.join("\n")}`);
    expect(list[0]).toBe("request:contacts");
    expect(list.filter((r) => r.startsWith("ledger:")).length).toBeGreaterThanOrEqual(1);
    expect(reads.length).toBeLessThanOrEqual(MEASURED);
  });
});
