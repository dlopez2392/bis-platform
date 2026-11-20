import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { A2pStatus, BillingStanding } from "@bis/db";
import { ALL_ON, billingVerdict, voiceBlock, type BillingVerdict } from "@/lib/billing/standing";

/**
 * F-088 PR 1: the grade. The pure table first (every cap x state cell, and an
 * exhaustive walk proving the unreachable cells stay unreachable), then the
 * cached read, driven through the SAME billing read the call path enforces.
 */

const SERVICE = { tag: "service" };
const world = vi.hoisted(() => ({
  standing: null as unknown,
  rows: {} as Record<string, unknown>,
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bis/db")>()),
  serviceDb: () => SERVICE,
  readBillingStanding: async () => world.standing,
}));
/** A data-API stand-in: every chain ends in maybeSingle, answering the table's row (an Error = a failed read). */
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from(table: string) {
      const b = {
        select: () => b, eq: () => b, not: () => b,
        maybeSingle: async () => {
          const r = world.rows[table];
          return r instanceof Error ? { data: null, error: { message: r.message } } : { data: r ?? null, error: null };
        },
      };
      return b;
    },
  }),
}));

const { capabilityState, readCapabilityFacts, CAPABILITIES } = await import("./capabilities");
type Facts = Parameters<typeof capabilityState>[1];

const A = "11111111-1111-4111-8111-111111111111";
const PAUSED: BillingVerdict = { paused: true, voice: false, concierge: false, forward: true };
const NO_VOICE: BillingVerdict = { paused: false, voice: false, concierge: true, forward: true };
const NO_CHAT: BillingVerdict = { paused: false, voice: true, concierge: false, forward: true };
const CRM: BillingVerdict = { paused: false, voice: false, concierge: false, forward: true };
const VERDICTS: BillingVerdict[] = [ALL_ON, NO_VOICE, NO_CHAT, CRM, PAUSED, { ...PAUSED, forward: false }];
const TRADES = ["plumbing", null, "restaurant", "child_care", "not_a_trade_key"];
const A2P: A2pStatus[] = ["not_started", "pending", "approved", "rejected"];

function ok(over: Partial<Extract<Facts, { read: "ok" }>> = {}): Facts {
  return {
    read: "ok", verdict: ALL_ON, trade: "plumbing", voiceProfileEnabled: true, conciergeLive: true,
    a2pStatus: "approved", ...over,
  };
}

/** Every cell of the 3 x 5 table: the reasons that reach it, each with one set of facts, or none (unreachable). */
const TABLE: [string, string, [string, Facts][]][] = [
  ["sofia", "live", [["sofia_answering", ok()], ["sofia_answering", ok({ trade: "restaurant" })]]],
  ["sofia", "needs_setup", [
    ["read_failed", { read: "failed" }], ["no_trade", ok({ trade: null, voiceProfileEnabled: false })],
    ["sofia_off", ok({ voiceProfileEnabled: false })],
  ]],
  ["sofia", "waiting", [["billing_paused", ok({ verdict: PAUSED })]]],
  ["sofia", "bigger_plan", [["plan_no_voice", ok({ verdict: NO_VOICE })]]],
  ["sofia", "absent", [["crm_only_trade", ok({ trade: "restaurant", voiceProfileEnabled: false })]]],
  ["webChat", "live", [["chat_open", ok()]]],
  ["webChat", "needs_setup", [
    ["read_failed", { read: "failed" }], ["no_trade", ok({ trade: null, conciergeLive: false })],
    ["chat_off", ok({ conciergeLive: false })],
  ]],
  ["webChat", "waiting", [["billing_paused", ok({ verdict: PAUSED })]]],
  ["webChat", "bigger_plan", [["plan_no_chat", ok({ verdict: NO_CHAT })]]],
  ["webChat", "absent", [["crm_only_trade", ok({ trade: "child_care", conciergeLive: false })]]],
  ["texting", "live", [["texting_registered", ok()]]],
  ["texting", "needs_setup", [
    ["read_failed", { read: "failed" }], ["not_registered", ok({ a2pStatus: "not_started" })],
    ["registration_rejected", ok({ a2pStatus: "rejected" })],
  ]],
  ["texting", "waiting", [["carrier_review", ok({ a2pStatus: "pending" })]]],
  ["texting", "bigger_plan", []],   // every plan texts
  ["texting", "absent", []],        // every trade texts
];

/** The whole fact space: 6 verdicts x 5 trades x 2 x 2 x 4 registrations, plus the failed read. */
function everyFacts(): Facts[] {
  const out: Facts[] = [{ read: "failed" }];
  for (const verdict of VERDICTS) for (const trade of TRADES) for (const voiceProfileEnabled of [true, false])
    for (const conciergeLive of [true, false]) for (const a2pStatus of A2P)
      out.push(ok({ verdict, trade, voiceProfileEnabled, conciergeLive, a2pStatus }));
  return out;
}

describe("capabilityState: the table", () => {
  it("covers exactly 15 cells", () => {
    expect(TABLE.length).toBe(15);
    expect(new Set(TABLE.map(([c, s]) => `${c}/${s}`)).size).toBe(15);
  });

  for (const [cap, state, rows] of TABLE) {
    for (const [reason, facts] of rows) {
      it(`${cap} / ${state} / ${reason}`, () => {
        expect(capabilityState(cap as never, facts)).toEqual({ state, reason });
      });
    }
  }

  it("over the whole fact space, every (cap, state, reason) produced is a table row, and every row is produced", () => {
    const produced = new Set<string>();
    for (const facts of everyFacts()) for (const cap of CAPABILITIES) {
      const g = capabilityState(cap, facts);
      produced.add(`${cap}/${g.state}/${g.reason}`);
    }
    const expected = new Set(TABLE.flatMap(([c, s, rows]) => rows.map(([r]) => `${c}/${s}/${r}`)));
    expect([...produced].sort()).toEqual([...expected].sort());
  });

  it("a failed read is never live, for any capability", () => {
    for (const cap of CAPABILITIES) expect(capabilityState(cap, { read: "failed" })).toEqual({ state: "needs_setup", reason: "read_failed" });
  });
});

describe("capabilityState: parity with what the call and chat paths enforce", () => {
  it("Sofía is in a bigger plan iff voiceBlock says plan-no-voice, for every verdict (a CRM-only trade aside: absent outranks it)", () => {
    for (const facts of everyFacts()) {
      if (facts.read !== "ok" || facts.trade === "restaurant" || facts.trade === "child_care") continue;
      expect(capabilityState("sofia", facts).state === "bigger_plan", JSON.stringify(facts))
        .toBe(voiceBlock(facts.verdict)?.reason === "plan-no-voice");
    }
  });

  it("the chat is live iff conciergeOpen would open it (isConciergeLive AND the verdict's concierge)", () => {
    for (const facts of everyFacts()) {
      if (facts.read !== "ok") continue;
      expect(capabilityState("webChat", facts).state === "live", JSON.stringify(facts))
        .toBe(facts.conciergeLive && facts.verdict.concierge);
    }
  });

  it("Sofía is live iff an enabled profile and a verdict that lets her answer", () => {
    for (const facts of everyFacts()) {
      if (facts.read !== "ok") continue;
      expect(capabilityState("sofia", facts).state === "live", JSON.stringify(facts))
        .toBe(facts.voiceProfileEnabled && voiceBlock(facts.verdict) === null);
    }
  });
});

// ---------------------------------------------------------------------------

function standing(features: { voice_receptionist: boolean; web_concierge: boolean }, pausedAt: string | null = null): BillingStanding {
  return { complimentary: false, pausedAt, subscriptionStatus: pausedAt ? "past_due" : "active", features };
}
const PROFILE = {
  account_id: A, enabled: true, public_id: "pub_1", concierge_enabled: true, concierge_form_id: "f1",
  concierge_destination: { status: "published", account_id: A },
};

/** The account as the billing mirror leaves it: accounts.permissions copies the plan's two flags. */
function setWorld(s: BillingStanding | null) {
  world.standing = s;
  world.rows = {
    accounts: { trade: "plumbing", a2p_status: "approved", permissions: s ? { ...s.features } : {} },
    voice_profiles: PROFILE,
  };
}

beforeEach(() => vi.stubEnv("BILLING_ENFORCE", "1"));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("readCapabilityFacts: the grade reads billingVerdictFor, never accounts.permissions", () => {
  const PAUSED_AT = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const STANDINGS: (BillingStanding | null)[] = [
    null,
    standing({ voice_receptionist: true, web_concierge: true }),
    standing({ voice_receptionist: false, web_concierge: true }),
    standing({ voice_receptionist: true, web_concierge: false }),
    standing({ voice_receptionist: false, web_concierge: false }),
    standing({ voice_receptionist: true, web_concierge: true }, PAUSED_AT),
  ];

  for (const enforce of ["1", ""]) {
    it(`BILLING_ENFORCE=${enforce || "off"}: Sofía in a bigger plan iff voiceBlock(billingVerdict) is plan-no-voice`, async () => {
      vi.stubEnv("BILLING_ENFORCE", enforce);
      for (const s of STANDINGS) {
        setWorld(s);
        const grade = capabilityState("sofia", await readCapabilityFacts(A));
        const enforced = voiceBlock(billingVerdict(s, enforce === "1", new Date()));
        expect(grade.state === "bigger_plan", JSON.stringify(s)).toBe(enforced?.reason === "plan-no-voice");
      }
    });
  }

  it("switch off, a plan without Sofía: she still answers, so the grade is live (mutation: read permissions → FAILS)", async () => {
    vi.stubEnv("BILLING_ENFORCE", "");
    setWorld(standing({ voice_receptionist: false, web_concierge: false }));
    const facts = await readCapabilityFacts(A);
    expect(capabilityState("sofia", facts)).toEqual({ state: "live", reason: "sofia_answering" });
    expect(capabilityState("webChat", facts)).toEqual({ state: "live", reason: "chat_open" });
  });

  it("reads the trade, the profile, the chat's published destination and the registration", async () => {
    setWorld(null);
    world.rows.accounts = { trade: "restaurant", a2p_status: "pending" };
    world.rows.voice_profiles = { ...PROFILE, enabled: false, concierge_destination: { status: "draft", account_id: A } };
    const facts = await readCapabilityFacts(A);
    expect(facts).toMatchObject({ read: "ok", trade: "restaurant", voiceProfileEnabled: false, conciergeLive: false, a2pStatus: "pending" });
  });

  it("no voice profile at all: Sofía and the chat need setup", async () => {
    setWorld(null);
    world.rows.voice_profiles = null;
    const facts = await readCapabilityFacts(A);
    expect(capabilityState("sofia", facts)).toEqual({ state: "needs_setup", reason: "sofia_off" });
    expect(capabilityState("webChat", facts)).toEqual({ state: "needs_setup", reason: "chat_off" });
  });

  for (const table of ["accounts", "voice_profiles"]) {
    it(`a failed ${table} read grades every capability needs_setup and logs the error class only, never its words`, async () => {
      setWorld(standing({ voice_receptionist: true, web_concierge: true }));
      world.rows[table] = new Error("row says Maria Pena +19565550123");
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const facts = await readCapabilityFacts(A);
      expect(facts).toEqual({ read: "failed" });
      for (const cap of CAPABILITIES) expect(capabilityState(cap, facts).state).toBe("needs_setup");
      expect(log).toHaveBeenCalledTimes(1);
      const line = String(log.mock.calls[0]?.[0]);
      expect(line).toContain(A);
      expect(line).toContain("Error");
      expect(line).not.toMatch(/Maria|9565550123|row says/);
    });
  }

  it("a missing accounts row is a failed read, never live", async () => {
    setWorld(null);
    world.rows.accounts = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readCapabilityFacts(A)).toEqual({ read: "failed" });
  });
});
