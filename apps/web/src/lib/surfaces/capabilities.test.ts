import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { A2pStatus, BillingStanding, PhoneNumberStatus } from "@bis/db";
import { ALL_ON, billingVerdict, voiceBlock, type BillingVerdict } from "@/lib/billing/standing";

/**
 * F-088 PR 1: the grade. The pure table first (every cap x state cell, and an
 * exhaustive walk proving the unreachable cells stay unreachable), then the
 * cached read, driven through the SAME billing read the call path enforces.
 */

const SERVICE = { tag: "service" };
const world = vi.hoisted(() => ({
  standing: null as unknown,
  /** By table, or `table.column` for the column the first eq() names (a more specific row wins). */
  rows: {} as Record<string, unknown>,
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bis/db")>()),
  serviceDb: () => SERVICE,
  readBillingStanding: async () => world.standing,
}));
/** A data-API stand-in: maybeSingle answers one row, order() a list; an Error stored there = a failed read. */
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from(table: string) {
      let key = table;
      const answer = async () => {
        const r = key in world.rows ? world.rows[key] : world.rows[table];
        return r instanceof Error ? { data: null, error: { message: r.message } } : { data: r ?? null, error: null };
      };
      const b = {
        select: () => b,
        eq: (col: string) => { if (key === table) key = `${table}.${col}`; return b; },
        not: () => b,
        maybeSingle: answer,
        order: answer,
      };
      return b;
    },
  }),
}));

const { capabilityState, readCapabilityFacts, CAPABILITIES } = await import("./capabilities");
type Facts = Parameters<typeof capabilityState>[1];
type OkFacts = Extract<Facts, { read: "ok" }>;

const A = "11111111-1111-4111-8111-111111111111";
const PAUSED: BillingVerdict = { paused: true, voice: false, concierge: false, forward: true };
const ENDED = { ...PAUSED, cause: "ended" as const };
const NO_VOICE: BillingVerdict = { paused: false, voice: false, concierge: true, forward: true };
const NO_CHAT: BillingVerdict = { paused: false, voice: true, concierge: false, forward: true };
const CRM: BillingVerdict = { paused: false, voice: false, concierge: false, forward: true };
const VERDICTS: (BillingVerdict & { cause?: "payment" | "ended" | null })[] = [ALL_ON, NO_VOICE, NO_CHAT, CRM, PAUSED, { ...PAUSED, forward: false }, ENDED, { ...PAUSED, cause: "payment" as const }];
const TRADES = ["plumbing", null, "restaurant", "child_care", "not_a_trade_key"];
const CRM_ONLY = new Set<string | null>(["restaurant", "child_care"]);
const PROFILES: OkFacts["profile"][] = [null, { enabled: true }, { enabled: false }, { enabled: true, forwardCalls: true }, { enabled: false, forwardCalls: true }];
const NUMBER_SETS: PhoneNumberStatus[][] = [[], ["provisioned"], ["released"], ["testing"], ["live"], ["provisioned", "live"], ["live", "testing"]];
const A2P: A2pStatus[] = ["not_started", "pending", "approved", "rejected"];

function ok(over: Partial<OkFacts> = {}): Facts {
  return {
    read: "ok", verdict: ALL_ON, trade: "plumbing", profile: { enabled: true }, numberStatuses: ["live"],
    conciergeLive: true, a2pStatus: "approved", ...over,
  };
}
const OFF = { enabled: false };

/** Every cell of the 3 x 5 table: the reasons that reach it, each with one set of facts, or none (unreachable). */
const TABLE: [string, string, [string, Facts][]][] = [
  ["sofia", "live", [
    ["sofia_answering", ok()], ["sofia_answering", ok({ trade: "restaurant" })],
    // accept-gate.ts: a testing number answers even with the profile switched off.
    ["sofia_testing", ok({ profile: OFF, numberStatuses: ["testing"] })],
  ]],
  ["sofia", "needs_setup", [
    ["read_failed", { read: "failed" }], ["no_trade", ok({ trade: null, profile: OFF })],
    ["sofia_off", ok({ profile: OFF })], ["sofia_off", ok({ profile: null, numberStatuses: ["testing"] })],
    ["no_number", ok({ numberStatuses: [] })], ["no_number", ok({ numberStatuses: ["provisioned", "released"] })],
    // route.ts: a cleared call goes to the transfer number while forward_calls is on, so Sofía is not answering.
    ["calls_forwarded", ok({ profile: { enabled: true, forwardCalls: true } })],
  ]],
  ["sofia", "waiting", [["billing_paused", ok({ verdict: PAUSED })], ["billing_ended", ok({ verdict: ENDED })]]],
  ["sofia", "bigger_plan", [["plan_no_voice", ok({ verdict: NO_VOICE })]]],
  ["sofia", "absent", [["crm_only_trade", ok({ trade: "restaurant", profile: OFF })]]],
  ["webChat", "live", [["chat_open", ok()]]],
  ["webChat", "needs_setup", [
    ["read_failed", { read: "failed" }], ["no_trade", ok({ trade: null, conciergeLive: false })],
    ["chat_off", ok({ conciergeLive: false })],
  ]],
  ["webChat", "waiting", [["billing_paused", ok({ verdict: PAUSED })], ["billing_ended", ok({ verdict: ENDED })]]],
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

/** The whole fact space, plus the failed read. */
function everyFacts(): OkFacts[] {
  const out: OkFacts[] = [];
  for (const verdict of VERDICTS) for (const trade of TRADES) for (const profile of PROFILES)
    for (const numberStatuses of NUMBER_SETS) for (const conciergeLive of [true, false]) for (const a2pStatus of A2P)
      out.push(ok({ verdict, trade, profile, numberStatuses, conciergeLive, a2pStatus }) as OkFacts);
  return out;
}
const FACTS = everyFacts();

/** What the TeXML route does with a call, stated independently of the module: a testing number answers
 *  any existing profile, a live number only an enabled one, and then billing must not block. */
function callPathAnswers(f: OkFacts): boolean {
  const numberAnswers = f.numberStatuses.some((s) =>
    (s === "testing" && f.profile !== null) || (s === "live" && f.profile?.enabled === true));
  return numberAnswers && voiceBlock(f.verdict) === null;
}
/** route.ts ~1110: after the billing check, forward_calls on sends a cleared call to the transfer number. */
const forwarded = (f: OkFacts) => callPathAnswers(f) && f.profile?.forwardCalls === true;

describe("capabilityState: the table", () => {
  it("covers exactly 15 cells", () => {
    expect(TABLE.length).toBe(15);
    expect(new Set(TABLE.map(([c, s]) => `${c}/${s}`)).size).toBe(15);
  });

  for (const [cap, state, rows] of TABLE) {
    for (const [reason, facts] of rows) {
      it(`${cap} / ${state} / ${reason} ${JSON.stringify(facts)}`, () => {
        expect(capabilityState(cap as never, facts)).toEqual({ state, reason });
      });
    }
  }

  it("over the whole fact space, every (cap, state, reason) produced is a table row, and every row is produced", () => {
    const produced = new Set<string>();
    for (const facts of [{ read: "failed" } as Facts, ...FACTS]) for (const cap of CAPABILITIES) {
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
  it("Sofía is in a bigger plan iff voiceBlock says plan-no-voice, for every verdict (a CRM-only trade aside: pinned below)", () => {
    for (const f of FACTS) {
      if (CRM_ONLY.has(f.trade)) continue;
      expect(capabilityState("sofia", f).state === "bigger_plan", JSON.stringify(f))
        .toBe(voiceBlock(f.verdict)?.reason === "plan-no-voice");
    }
  });

  it("a CRM-only trade is absent unless it is live, for Sofía and the chat, across every verdict (paused, no voice, no chat, all on)", () => {
    let absent = 0;
    for (const f of FACTS) {
      if (!CRM_ONLY.has(f.trade)) continue;
      const sofia = capabilityState("sofia", f);
      const chat = capabilityState("webChat", f);
      expect(sofia.state, JSON.stringify(f)).toBe(callPathAnswers(f) ? (forwarded(f) ? "needs_setup" : "live") : "absent");
      expect(chat.state, JSON.stringify(f)).toBe(f.conciergeLive && f.verdict.concierge ? "live" : "absent");
      if (sofia.state === "absent" && voiceBlock(f.verdict) !== null) absent += 1;
    }
    expect(absent).toBeGreaterThan(0); // the walk did reach paused and plan-blocked CRM-only facts
  });

  it("the chat is live iff conciergeOpen would open it (isConciergeLive AND the verdict's concierge)", () => {
    for (const f of FACTS) {
      expect(capabilityState("webChat", f).state === "live", JSON.stringify(f)).toBe(f.conciergeLive && f.verdict.concierge);
    }
  });

  it("Sofía is live iff the call path answers: an answerable testing or live number, and billing does not block", () => {
    for (const f of FACTS) {
      expect(capabilityState("sofia", f).state === "live", JSON.stringify(f)).toBe(callPathAnswers(f) && !forwarded(f));
    }
  });

  it("forward_calls on: Sofía is never live or answering while the route forwards, and only then calls_forwarded (mutation: drop the forwardCalls check -> FAILS)", () => {
    let seen = 0;
    for (const f of FACTS) {
      const g = capabilityState("sofia", f);
      expect(g.reason === "calls_forwarded", JSON.stringify(f)).toBe(forwarded(f));
      if (forwarded(f)) { seen += 1; expect(g.state).toBe("needs_setup"); }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("an enabled profile with no answerable number needs setup (no_number), never live", () => {
    for (const numberStatuses of [[], ["provisioned"], ["released"]] as PhoneNumberStatus[][]) {
      expect(capabilityState("sofia", ok({ numberStatuses }))).toEqual({ state: "needs_setup", reason: "no_number" });
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
const LIVE_NUMBER = [{ id: "n1", account_id: A, e164: "+19565550100", telnyx_id: "t1", status: "live" }];

/** The account as the billing mirror leaves it: accounts.permissions copies the plan's two flags. */
function setWorld(s: BillingStanding | null, trade = "plumbing") {
  world.standing = s;
  world.rows = {
    accounts: { trade, a2p_status: "approved", permissions: s ? { ...s.features } : {} },
    voice_profiles: PROFILE,
    phone_numbers: LIVE_NUMBER,
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

    it(`BILLING_ENFORCE=${enforce || "off"}: a restaurant is absent unless the call path or the chat really answers`, async () => {
      vi.stubEnv("BILLING_ENFORCE", enforce);
      for (const s of STANDINGS) for (const switchedOn of [true, false]) {
        setWorld(s, "restaurant");
        world.rows.voice_profiles = { ...PROFILE, enabled: switchedOn, concierge_enabled: switchedOn };
        const facts = await readCapabilityFacts(A);
        const v = billingVerdict(s, enforce === "1", new Date());
        const label = `${JSON.stringify(s)} on=${switchedOn}`;
        expect(capabilityState("sofia", facts).state, label).toBe(switchedOn && voiceBlock(v) === null ? "live" : "absent");
        expect(capabilityState("webChat", facts).state, label).toBe(switchedOn && v.concierge ? "live" : "absent");
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

  it("reads the trade, the profile, the numbers, the chat's published destination and the registration", async () => {
    setWorld(null);
    world.rows.accounts = { trade: "restaurant", a2p_status: "pending" };
    world.rows.voice_profiles = { ...PROFILE, enabled: false };
    world.rows["voice_profiles.public_id"] = { ...PROFILE, enabled: false, concierge_destination: { status: "draft", account_id: A } };
    world.rows.phone_numbers = [{ ...LIVE_NUMBER[0], status: "testing" }];
    const facts = await readCapabilityFacts(A);
    expect(facts).toEqual({
      read: "ok", verdict: expect.any(Object), trade: "restaurant", profile: { enabled: false, forwardCalls: false },
      numberStatuses: ["testing"], conciergeLive: false, a2pStatus: "pending",
    });
    // A testing number answers with the profile off (accept-gate.ts), so Sofía is live in testing mode.
    expect(capabilityState("sofia", facts)).toEqual({ state: "live", reason: "sofia_testing" });
  });

  it("reads forward_calls off the profile: on, Sofía's grade is calls_forwarded (mutation: ignore forward_calls -> FAILS)", async () => {
    setWorld(null);
    world.rows.voice_profiles = { ...PROFILE, forward_calls: true };
    expect(capabilityState("sofia", await readCapabilityFacts(A))).toEqual({ state: "needs_setup", reason: "calls_forwarded" });
  });

  it("an enabled profile and no number: Sofía needs setup, never live (mutation: drop the number condition → FAILS)", async () => {
    setWorld(null);
    world.rows.phone_numbers = [];
    expect(capabilityState("sofia", await readCapabilityFacts(A))).toEqual({ state: "needs_setup", reason: "no_number" });
  });

  it("no voice profile at all: Sofía and the chat need setup", async () => {
    setWorld(null);
    world.rows.voice_profiles = null;
    const facts = await readCapabilityFacts(A);
    expect(capabilityState("sofia", facts)).toEqual({ state: "needs_setup", reason: "sofia_off" });
    expect(capabilityState("webChat", facts)).toEqual({ state: "needs_setup", reason: "chat_off" });
  });

  const FAILURES: [string, string, unknown][] = [
    ["accounts", "accounts", new Error("row says Maria Pena +19565550123")],
    ["no_row", "accounts", null],
    ["voice_profile", "voice_profiles.account_id", new Error("row says Maria Pena +19565550123")],
    ["number", "phone_numbers", new Error("row says Maria Pena +19565550123")],
    ["chat", "voice_profiles.public_id", new Error("row says Maria Pena +19565550123")],
  ];
  for (const [stage, key, value] of FAILURES) {
    it(`a failed read at ${stage} grades every capability needs_setup and logs the stage and the error class only`, async () => {
      setWorld(standing({ voice_receptionist: true, web_concierge: true }));
      world.rows[key] = value;
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const facts = await readCapabilityFacts(A);
      expect(facts).toEqual({ read: "failed" });
      for (const cap of CAPABILITIES) expect(capabilityState(cap, facts).state).toBe("needs_setup");
      expect(log).toHaveBeenCalledTimes(1);
      const line = String(log.mock.calls[0]?.[0]);
      expect(line).toContain(A);
      expect(line).toContain(` at ${stage};`);
      expect(line).not.toMatch(/Maria|9565550123|row says/);
    });
  }
});
