import { describe, it, expect, vi, beforeAll } from "vitest";

/**
 * Reads per open of the record summary (item 8a-2, spec 7): every from()/rpc() the route makes, through
 * stand-ins for the request and the service client, over the REAL readers, builder, service and gateway
 * (AI_PROVIDER=fake: no network). A fence: a new read fails it by name. Two customers: one with nothing
 * (the route stops at "none": request reads only) and one with one booking (the full path: the gate, the
 * cache read, the claim, the gateway's own gate and ledger, the save).
 */
type Read = { client: "request" | "service"; target: string };
const reads: Read[] = [];
const A = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";
const SINGLE: Record<string, unknown> = {
  contacts: { id: C, account_id: A, first_name: "Maria", last_name: "Garcia", email: null, phone: null, company_name: null,
    created_at: "2025-12-02T00:00:00Z", source: null, custom: {}, attribution: null, assigned_to: null, language: null, phone_country_unconfirmed: false },
  accounts: { timezone: "America/Chicago", language: null },
};
const LISTS: Record<string, unknown[]> = {};
const RPC: Record<string, unknown> = {
  ai_gate_check: { global_enabled: true, account_enabled: true, budget_microusd: 10_000_000, month_spend_microusd: 0, record_summaries_today: 0 },
  claim_record_summary: { status: "won", lease_id: "33333333-3333-4333-8333-333333333333" },
  ai_ledger_record: null,
};
function recordingClient(client: Read["client"]) {
  const chain = (target: string) => {
    let single = false;
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") {
          const rpc = target.startsWith("rpc:") ? target.slice(4) : null;
          const data = rpc ? RPC[rpc] ?? null
            : target === "record_summaries:update" ? [{ id: "r1" }]
            : single ? SINGLE[target] ?? null : LISTS[target] ?? [];
          const result = { data, error: null, count: 0 };
          return (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad);
        }
        return () => { if (prop === "maybeSingle" || prop === "single") single = true; if (prop === "update") target = `${target}:update`; return proxy; };
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
const service = recordingClient("service");
vi.mock("@/lib/auth", () => ({ apiAccountAccess: async () => ({ userId: "u1", isAgency: true }) }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => request }));
// Its own one-row read of the person's users row (its own client): counted by hand, +1.
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: null, theme: null }) }));
vi.mock("@/lib/zone", () => ({ renderZone: async (z?: string) => ({ zone: z ?? "UTC", guessed: !z, label: z ?? "UTC", source: "account" }) }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@bis/db")>()), serviceDb: () => service }));

beforeAll(() => { vi.stubEnv("AI_PROVIDER", "fake"); });
const { GET } = await import("./route");
const open = () => GET(new Request(`http://x/api/accounts/${A}/contacts/${C}/ai-summary`), { params: Promise.resolve({ accountId: A, contactId: C }) });

/** Set from the first run (Step 5) and dated; never raised without the report saying why. */
// Measured 2026-10-18 (item 8a-2, Task 6): 12 reads (+1 prefs), all on the request client:
// request:contacts (getContact, the proof), request:accounts (zone and language), then the builder:
// contactFacts' four (bookings, conversations, calls, opportunities), its own bookings twice (the five
// newest and the next one), opportunities, tasks, documents, and listContactCalls' calls. No service read.
const MEASURED_EMPTY = 12;
// Measured 2026-10-18 (item 8a-2, Task 6): 18 reads (+1 prefs): the same 12, then six: service:rpc:ai_gate_check
// (the route's gate), request:record_summaries (the cache, under RLS), service:rpc:claim_record_summary,
// service:rpc:ai_gate_check and service:rpc:ai_ledger_record (the gateway's own gate and ledger row),
// service:record_summaries (the save). A customer with an open deal adds the builder's bounded
// pipeline_stages read (this fixture has none).
const MEASURED_FULL = 18;

describe("reads per open of the record summary (spec 7: measured, not assumed)", () => {
  it("a customer with nothing: the contact first, request reads only, and stops at none (mutation: build the service client before hasSomethingToSay -> a service read appears -> FAILS)", async () => {
    reads.length = 0;
    const res = await open();
    expect(await res.json()).toEqual({ state: "none" });
    const list = reads.map((r) => `${r.client}:${r.target}`);
    console.info(`record summary reads (nothing to say): ${reads.length} (+1 getPersonPrefs)\n${list.join("\n")}`);
    expect(list[0]).toBe("request:contacts");
    expect(list.filter((r) => r.startsWith("service:"))).toEqual([]);
    expect(reads.length).toBeLessThanOrEqual(MEASURED_EMPTY);
  });

  it("a customer with a booking: the gate, the cache read under RLS, the claim, the gateway's gate and ledger, the save, in that order (mutations: read the cache on the service client -> FAILS; claim before the gate -> FAILS)", async () => {
    reads.length = 0;
    LISTS.bookings = [{ starts_at: "2026-10-20T15:00:00Z", status: "booked" }];
    const body = await (await open()).json();
    delete LISTS.bookings;
    expect(body).toMatchObject({ state: "ready", text: expect.stringMatching(/^\[fake en\] [0-9a-f]{8}$/), language: "en" });
    const list = reads.map((r) => `${r.client}:${r.target}`);
    console.info(`record summary reads (full path): ${reads.length} (+1 getPersonPrefs)\n${list.join("\n")}`);
    expect(list[0]).toBe("request:contacts");
    const tail = list.filter((r) => r.startsWith("service:") || r === "request:record_summaries");
    expect(tail).toEqual([
      "service:rpc:ai_gate_check", "request:record_summaries", "service:rpc:claim_record_summary",
      "service:rpc:ai_gate_check", "service:rpc:ai_ledger_record", "service:record_summaries",
    ]);
    expect(reads.length).toBeLessThanOrEqual(MEASURED_FULL);
  });
});
