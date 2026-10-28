import { describe, it, expect, vi, afterEach } from "vitest";
import { PASSES } from "./registry";
import { RELEASERS } from "./passes/release-held";
import type { HeartbeatOutcome } from "./harness";
import {
  PLAN, JOBS_DRAIN_KEY, JOBS_DRAIN_MAX_S, PASS_ROUTE_MAX_S, ANSWER_GRACE_S,
  fanoutEnabled, longestPathS, runFanout, httpInvoke,
  type Answer, type Invoke, type FanoutBeat, type PlanNode,
} from "./fanout";

/**
 * F-196: every registered pass runs in its own invocation, started by the
 * dispatcher as soon as its predecessors allow. The PLAN is the registry's
 * order turned into a graph; the executor is the one place that decides what
 * starts, what waits and what never starts. Both are read against the REAL
 * registry and the REAL release pass, as cron-coupling.test.ts reads real
 * constants, so a recipe added to either without a line here fails.
 */

const keys = (plan: readonly PlanNode[]) => plan.map((n) => n.key);
const node = (key: string): PlanNode => {
  const found = PLAN.find((n) => n.key === key);
  if (!found) throw new Error(`no plan node ${key}`);
  return found;
};
function ancestors(key: string, seen = new Set<string>()): Set<string> {
  for (const p of node(key).after) {
    if (!seen.has(p)) { seen.add(p); ancestors(p, seen); }
  }
  return seen;
}

const RELEASED = ["reminders", "followups", "noShowNudges", "smsReminders", "appointmentConfirms", "quoteFollowups"];
const TRANSITIVELY_BLOCKED = ["reviewRequests", "referralAsks", "reactivations"];
const NOT_AFTER_RELEASE = [
  "billingPause", "releaseHeld", "cancelNotices", "siteTraffic", "documentsSweep", "documentsScan",
  "documentsExpiry", "weeklyClientReport", "weeklyAgencyReport", JOBS_DRAIN_KEY, "usageReport", "opsWatch",
];

describe("PLAN — the registry as a dependency graph", () => {
  it("1. holds exactly the registry's keys plus jobsDrain, each once, in registry order with jobsDrain after weeklyAgencyReport", () => {
    const expected = PASSES.map((p) => p.key);
    expected.splice(expected.indexOf("weeklyAgencyReport") + 1, 0, JOBS_DRAIN_KEY);
    expect(keys(PLAN)).toEqual(expected);
    expect(new Set(keys(PLAN)).size).toBe(PLAN.length);
    expect(PLAN).toHaveLength(21);
  });

  it("2. every edge between two registered passes runs earlier -> later in PASSES, and jobsDrain's only dependants are usageReport and opsWatch (mutation: add \"reminders\" to releaseHeld's after -> FAILS)", () => {
    const order = PASSES.map((p) => p.key);
    const backwards: string[] = [];
    for (const n of PLAN) {
      for (const p of n.after) {
        if (order.includes(p) && order.includes(n.key) && order.indexOf(p) >= order.indexOf(n.key)) {
          backwards.push(`${p} -> ${n.key}`);
        }
      }
    }
    expect(backwards).toEqual([]);
    expect(keys(PLAN.filter((n) => n.after.includes(JOBS_DRAIN_KEY)))).toEqual(["usageReport", "opsWatch"]);
    expect(node(JOBS_DRAIN_KEY).ceilingS).toBe(JOBS_DRAIN_MAX_S);
    expect(PLAN.filter((n) => n.key !== JOBS_DRAIN_KEY).every((n) => n.ceilingS === PASS_ROUTE_MAX_S)).toBe(true);
  });

  it("3. every releaser the release pass can call is classified, and each one that is a pass runs only after releaseHeld (mutation: reminders' after -> [\"billingPause\"], or a new releaser source left unclassified -> FAILS)", () => {
    const PASS_OF: Record<string, string> = {
      reminders: "reminders", followups: "followups", review_request: "reviewRequests",
      no_show_nudge: "noShowNudges", sms_reminder: "smsReminders", appointment_confirm: "appointmentConfirms",
      referral_ask: "referralAsks", reactivation: "reactivations", quote_followup: "quoteFollowups",
    };
    const NOT_A_PASS = ["instant_reply", "textback", "document_request"];
    const live = Object.entries(RELEASERS).filter(([, r]) => r !== null).map(([source]) => source);
    expect(live).toHaveLength(12);
    expect(live.filter((s) => !(s in PASS_OF) && !NOT_A_PASS.includes(s))).toEqual([]);
    const unguarded = live.filter((s) => s in PASS_OF).filter((s) => !ancestors(PASS_OF[s]!).has("releaseHeld"));
    expect(unguarded).toEqual([]);
  });

  it("4. the six recipes after releaseHeld are `released` and nothing else is; reviewRequests and referralAsks are `completed`; usageReport and opsWatch are `regardless`, after every other node, opsWatch after usageReport (mutation: make reminders or reviewRequests `settled` -> FAILS)", () => {
    expect(keys(PLAN.filter((n) => n.rule === "released"))).toEqual(RELEASED);
    for (const k of RELEASED) expect(node(k).after).toEqual(["releaseHeld"]);
    expect(keys(PLAN.filter((n) => n.rule === "completed"))).toEqual(["reviewRequests", "referralAsks"]);
    expect(keys(PLAN.filter((n) => n.rule === "regardless"))).toEqual(["usageReport", "opsWatch"]);
    const all = keys(PLAN);
    expect([...node("usageReport").after].sort()).toEqual(all.filter((k) => k !== "usageReport" && k !== "opsWatch").sort());
    expect([...node("opsWatch").after].sort()).toEqual(all.filter((k) => k !== "opsWatch").sort());
  });

  it("5. longestPathS takes the MAX over predecessors: a(10), b(10)<-a, c(50)<-a, d(10)<-b,c with grace 5 is 85 (mutation: add the predecessors' paths -> 115, FAILS)", () => {
    const toy: PlanNode[] = [
      { key: "a", after: [], rule: "settled", ceilingS: 10 },
      { key: "b", after: ["a"], rule: "settled", ceilingS: 10 },
      { key: "c", after: ["a"], rule: "settled", ceilingS: 50 },
      { key: "d", after: ["b", "c"], rule: "settled", ceilingS: 10 },
    ];
    expect(longestPathS(toy, 5)).toBe(85);
    expect(longestPathS(toy.slice(0, 2), 5)).toBe(30);
    expect(longestPathS([toy[0]!])).toBe(10 + ANSWER_GRACE_S);
  });
});

// ---------------------------------------------------------------------------
// The executor. `invoke` answers 200 at once unless the test holds a key (its
// answer is then a deferred the test resolves) or scripts its answer; `beat`
// writes into the same `events` log, so ordering is read off one sequence.

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

const NOW = new Date("2026-10-28T14:15:00.000Z");
const OK: Answer = { status: 200, counters: { sent: 0 } };
type Scripted = Answer | "reject";

function harness(opts: {
  answers?: Record<string, Scripted>;
  hold?: readonly string[];
  beatHold?: Record<string, Promise<void>>;
  beatThrows?: boolean;
  plan?: readonly PlanNode[];
} = {}) {
  const events: string[] = [];
  const beats: [string, HeartbeatOutcome][] = [];
  const bodies: [string, { now: string }, AbortSignal][] = [];
  const held = new Map<string, Deferred<Answer>>();
  const settle = (key: string, s: Scripted): Promise<Answer> => {
    events.push(`answer:${key}`);
    return s === "reject" ? Promise.reject(new Error("socket hang up")) : Promise.resolve(s);
  };
  const invoke: Invoke = (key, body, signal) => {
    events.push(`invoke:${key}`);
    bodies.push([key, body, signal]);
    if (opts.hold?.includes(key)) {
      const d = deferred<Answer>();
      held.set(key, d);
      return d.promise.then((a) => settle(key, a), () => settle(key, "reject"));
    }
    return settle(key, opts.answers?.[key] ?? OK);
  };
  const beat: FanoutBeat = async (key, outcome) => {
    events.push(`beat:${key}`);
    beats.push([key, outcome]);
    if (opts.beatThrows) throw new Error("heartbeat table gone");
    const h = opts.beatHold?.[key];
    if (h) await h;
  };
  const run = runFanout({ plan: opts.plan ?? PLAN, now: NOW, invoke, beat });
  const invoked = (k: string) => events.includes(`invoke:${k}`);
  const answer = (k: string, a: Answer = OK) => {
    const d = held.get(k);
    if (!d) throw new Error(`${k} was not invoked (yet)`);
    d.resolve(a);
  };
  return { events, beats, bodies, run, invoked, answer };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("runFanout — what starts, and when", () => {
  it("6. siteTraffic starts as soon as billingPause answers, while releaseHeld is still in flight; once releaseHeld answers, reminders and followups are both in flight before either answers (mutation: await each invoke before starting the next -> FAILS)", async () => {
    const h = harness({ hold: ["billingPause", "releaseHeld", "reminders", "followups"] });
    await flush();
    expect(h.events).toEqual(["invoke:billingPause"]);

    h.answer("billingPause");
    await flush();
    expect(h.invoked("releaseHeld")).toBe(true);
    expect(h.invoked("siteTraffic")).toBe(true);
    expect(h.events).not.toContain("answer:releaseHeld");

    h.answer("releaseHeld");
    await flush();
    expect(h.invoked("reminders")).toBe(true);
    expect(h.invoked("followups")).toBe(true);
    expect(h.events).not.toContain("answer:reminders");
    expect(h.events).not.toContain("answer:followups");

    h.answer("reminders");
    h.answer("followups");
    await expect(h.run).resolves.toBeDefined();
  });

  it("7. no recipe starts before releaseHeld answers, while everything not after it runs", async () => {
    const h = harness({ hold: ["releaseHeld"] });
    await flush();
    for (const k of ["cancelNotices", "siteTraffic", "documentsSweep", "documentsScan", "documentsExpiry",
      "weeklyClientReport", "weeklyAgencyReport", JOBS_DRAIN_KEY]) expect(h.invoked(k), k).toBe(true);
    for (const k of [...RELEASED, ...TRANSITIVELY_BLOCKED]) expect(h.invoked(k), k).toBe(false);
    expect(h.invoked("usageReport")).toBe(false);

    h.answer("releaseHeld");
    await flush();
    for (const k of RELEASED) expect(h.invoked(k), k).toBe(true);
    const results = await h.run;
    expect(Object.keys(results)).toEqual(keys(PLAN));
    expect(Object.values(results).every((c) => c.sent === 0)).toBe(true);
  });

  it("8. followups answers 504 -> reviewRequests and referralAsks never start, reactivations does, cron.pass.followups failed with HTTP 504 (mutation: treat any answer as completed -> reviewRequests starts, FAILS)", async () => {
    const h = harness({ answers: { followups: { status: 504, counters: null } } });
    const results = await h.run;
    expect(results.followups).toEqual({ errored: 1 });
    expect(results.reviewRequests).toEqual({ notStarted: 1 });
    expect(results.referralAsks).toEqual({ notStarted: 1 });
    expect(h.invoked("reviewRequests")).toBe(false);
    expect(h.invoked("referralAsks")).toBe(false);
    expect(h.invoked("reactivations")).toBe(true);
    expect(results.reactivations).toEqual({ sent: 0 });
    expect(h.beats).toContainEqual(["cron.pass.followups", { ok: false, error: "the pass's function answered HTTP 504" }]);
    // A skipped node writes nothing: its predecessor's own failure is the alert.
    expect(h.beats.map(([k]) => k)).not.toContain("cron.pass.reviewRequests");
    expect(h.beats.map(([k]) => k)).not.toContain("cron.pass.referralAsks");
  });

  const releaseRuns: { name: string; answer: Scripted; release: Record<string, number>; cause: string }[] = [
    { name: "releaseHeld gives no answer", answer: "reject", release: { errored: 1, noAnswer: 1 }, cause: "not started: the release pass did not answer" },
    { name: "releaseHeld answers 502 (Spec correction 11)", answer: { status: 502, counters: null }, release: { errored: 1 }, cause: "not started: the release pass answered HTTP 502" },
    { name: "releaseHeld answers 200 with an unreadable body", answer: { status: 200, counters: null }, release: { unreadable: 1 }, cause: "not started: the release pass answered unreadably" },
  ];
  for (const r of releaseRuns) {
    it(`9. ${r.name} -> every recipe never starts and the rest run; each released recipe writes ONE failed beat naming the cause, before usageReport starts (mutations: decide tests only noAnswer; drop the released line; treat counters:null as completed; drop the blocked-node write; write after recording done -> FAILS)`, async () => {
      const h = harness({ answers: { releaseHeld: r.answer } });
      const results = await h.run;
      expect(results.releaseHeld).toEqual(r.release);
      for (const k of [...RELEASED, ...TRANSITIVELY_BLOCKED]) {
        expect(results[k], k).toEqual({ notStarted: 1 });
        expect(h.invoked(k), k).toBe(false);
      }
      for (const k of NOT_AFTER_RELEASE) expect(h.invoked(k), k).toBe(true);

      for (const k of RELEASED) {
        expect(h.beats.filter(([b]) => b === `cron.pass.${k}`), k).toEqual([[`cron.pass.${k}`, { ok: false, error: r.cause }]]);
        expect(h.events.indexOf(`beat:cron.pass.${k}`), k).toBeLessThan(h.events.indexOf("invoke:usageReport"));
      }
      for (const k of TRANSITIVELY_BLOCKED) expect(h.beats.map(([b]) => b), k).not.toContain(`cron.pass.${k}`);
    });
  }

  it("9b. a blocked recipe's failure beat is AWAITED before the recipe counts as done, without stalling the rest: while reminders' beat is held open, the other branches run and usageReport does not start (mutations: record done before the write; fire the write without awaiting it -> FAILS)", async () => {
    const gate = deferred<void>();
    const h = harness({
      answers: { releaseHeld: { status: 502, counters: null } },
      beatHold: { "cron.pass.reminders": gate.promise },
    });
    await flush();
    expect(h.events).toContain("beat:cron.pass.reminders");
    for (const k of NOT_AFTER_RELEASE.filter((k) => k !== "usageReport" && k !== "opsWatch")) {
      expect(h.events, k).toContain(`answer:${k}`);
    }
    expect(h.invoked("usageReport")).toBe(false);
    expect(h.invoked("opsWatch")).toBe(false);

    gate.resolve();
    await flush();
    expect(h.invoked("usageReport")).toBe(true);
    const results = await h.run;
    expect(results.reminders).toEqual({ notStarted: 1 });
  });

  it("9c. releaseHeld answers 200 with NO counters field at all -> unreadable, and the recipes stay blocked: one predicate reads unreadable for both the release rule and the counters (mutation: isCompleted tests `counters !== null` -> the recipes start, FAILS)", async () => {
    const h = harness({ answers: { releaseHeld: { status: 200 } as unknown as Answer } });
    const results = await h.run;
    expect(results.releaseHeld).toEqual({ unreadable: 1 });
    for (const k of [...RELEASED, ...TRANSITIVELY_BLOCKED]) {
      expect(results[k], k).toEqual({ notStarted: 1 });
      expect(h.invoked(k), k).toBe(false);
    }
    for (const k of RELEASED) {
      expect(h.beats.filter(([b]) => b === `cron.pass.${k}`), k).toEqual([[`cron.pass.${k}`, { ok: false, error: "not started: the release pass answered unreadably" }]]);
    }
  });

  it("9d. billingPause gives no answer -> only billingPause, usageReport and opsWatch run, 18 nodes never start, each released recipe's beat names the billing pause as the cause, then cron.tick (mutation: drop the root cause from the blocked wording -> FAILS)", async () => {
    const h = harness({ answers: { billingPause: "reject" } });
    const results = await h.run;
    expect(h.events.filter((e) => e.startsWith("invoke:"))).toEqual(["invoke:billingPause", "invoke:usageReport", "invoke:opsWatch"]);
    expect(results.billingPause).toEqual({ errored: 1, noAnswer: 1 });
    const notStarted = keys(PLAN).filter((k) => results[k]?.notStarted === 1);
    expect(notStarted).toEqual(keys(PLAN).filter((k) => !["billingPause", "usageReport", "opsWatch"].includes(k)));
    expect(notStarted).toHaveLength(18);
    expect(h.beats).toEqual([
      ["cron.pass.billingPause", { ok: false, error: "the pass's function did not answer: Error: socket hang up" }],
      ...RELEASED.map((k) => [`cron.pass.${k}`, { ok: false, error: "not started: the release pass was not started because the billingPause pass did not answer" }]),
      ["cron.tick", { ok: true }],
    ]);
    for (const k of RELEASED) expect(h.events.indexOf(`beat:cron.pass.${k}`), k).toBeLessThan(h.events.indexOf("invoke:usageReport"));
  });

  it("9e. the cause named is the ROOT that gave no answer, however deep: a -> b -> c -> d(released), a silent -> d's beat names a (mutation: a blocked node records its direct predecessor as the cause -> names b, FAILS)", async () => {
    const h = harness({
      answers: { a: "reject" },
      plan: [
        { key: "a", after: [], rule: "settled", ceilingS: 1 },
        { key: "b", after: ["a"], rule: "settled", ceilingS: 1 },
        { key: "c", after: ["b"], rule: "settled", ceilingS: 1 },
        { key: "d", after: ["c"], rule: "released", ceilingS: 1 },
      ],
    });
    expect(await h.run).toEqual({ a: { errored: 1, noAnswer: 1 }, b: { notStarted: 1 }, c: { notStarted: 1 }, d: { notStarted: 1 } });
    expect(h.beats.filter(([k]) => k === "cron.pass.d")).toEqual([
      ["cron.pass.d", { ok: false, error: "not started: the release pass was not started because the a pass did not answer" }],
    ]);
  });
});

describe("runFanout — the dispatcher's own heartbeats", () => {
  it("10a. a failure heartbeat is written for a non-200 and for no answer, never for a 200 (mutation: write one on 200 too -> FAILS)", async () => {
    const h = harness({ answers: { siteTraffic: { status: 504, counters: null }, documentsSweep: "reject" } });
    const results = await h.run;
    expect(results.siteTraffic).toEqual({ errored: 1 });
    expect(results.documentsSweep).toEqual({ errored: 1, noAnswer: 1 });
    // documentsScan and documentsExpiry are blocked behind the no-answer and write nothing.
    expect(results.documentsScan).toEqual({ notStarted: 1 });
    expect(results.documentsExpiry).toEqual({ notStarted: 1 });
    expect([...h.beats].sort(([a], [b]) => a.localeCompare(b))).toEqual([
      ["cron.pass.documentsSweep", { ok: false, error: "the pass's function did not answer: Error: socket hang up" }],
      ["cron.pass.siteTraffic", { ok: false, error: "the pass's function answered HTTP 504" }],
      ["cron.tick", { ok: true }],
    ]);
  });

  it("10b. a node's failure beat is AWAITED before the node counts as done: while weeklyAgencyReport's beat is held open, neither usageReport nor opsWatch starts (mutation: record done before awaiting the beat -> FAILS)", async () => {
    const gate = deferred<void>();
    const h = harness({
      answers: { weeklyAgencyReport: { status: 504, counters: null } },
      beatHold: { "cron.pass.weeklyAgencyReport": gate.promise },
    });
    await flush();
    for (const k of keys(PLAN).filter((k) => k !== "usageReport" && k !== "opsWatch")) {
      expect(h.events, k).toContain(`answer:${k}`);
    }
    expect(h.events).toContain("beat:cron.pass.weeklyAgencyReport");
    expect(h.invoked("usageReport")).toBe(false);
    expect(h.invoked("opsWatch")).toBe(false);

    gate.resolve();
    await flush();
    expect(h.invoked("usageReport")).toBe(true);
    expect(h.invoked("opsWatch")).toBe(true);
    await h.run;
  });

  it("11. cron.tick is written once, after opsWatch answers (mutation: write it before awaiting the last node -> FAILS)", async () => {
    const h = harness({ hold: ["opsWatch"] });
    await flush();
    expect(h.invoked("opsWatch")).toBe(true);
    expect(h.beats.map(([k]) => k)).not.toContain("cron.tick");

    h.answer("opsWatch");
    await h.run;
    expect(h.beats.filter(([k]) => k === "cron.tick")).toEqual([["cron.tick", { ok: true }]]);
    expect(h.events.indexOf("beat:cron.tick")).toBeGreaterThan(h.events.indexOf("answer:opsWatch"));
    expect(h.events.at(-1)).toBe("beat:cron.tick");
  });

  it("12. every invoke receives the same { now }, the input instant's ISO string, and a live abort signal", async () => {
    const h = harness();
    await h.run;
    expect(h.bodies).toHaveLength(PLAN.length);
    for (const [key, body, signal] of h.bodies) {
      expect(body, key).toEqual({ now: "2026-10-28T14:15:00.000Z" });
      expect(signal, key).toBeInstanceOf(AbortSignal);
      expect(signal.aborted, key).toBe(false);
    }
  });

  it("13. a beat that throws never rejects runFanout", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({ answers: { siteTraffic: { status: 504, counters: null }, releaseHeld: "reject" }, beatThrows: true });
    const results = await h.run;
    expect(results.siteTraffic).toEqual({ errored: 1 });
    expect(results.opsWatch).toEqual({ sent: 0 });
    expect(h.beats.map(([k]) => k)).toContain("cron.tick");
  });

  it("16. a plan that cannot finish (an unknown predecessor, or a cycle) throws instead of hanging", async () => {
    await expect(harness({ plan: [{ key: "a", after: ["ghost"], rule: "settled", ceilingS: 1 }] }).run).rejects.toThrow(/cannot finish/);
    await expect(harness({ plan: [
      { key: "a", after: ["b"], rule: "settled", ceilingS: 1 },
      { key: "b", after: ["a"], rule: "settled", ceilingS: 1 },
    ] }).run).rejects.toThrow(/cannot finish/);
  });
});

describe("httpInvoke — one POST per node, never following a redirect with the bearer", () => {
  const response = (status: number, body: string | null) => new Response(body, { status, ...(status >= 300 && status < 400 ? { headers: { location: "https://elsewhere.example.com/" } } : {}) });

  it("14. POSTs the node's route with the bearer, the JSON body, no-store and redirect: manual; a 200's JSON is the counters (mutation: drop redirect -> FAILS)", async () => {
    const fetchImpl = vi.fn(async () => response(200, JSON.stringify({ sent: 3, failed: 1 })));
    const signal = new AbortController().signal;
    const invoke = httpInvoke("https://app.example.com", "s3cret", fetchImpl as unknown as typeof fetch);

    await expect(invoke("reminders", { now: "2026-10-28T14:15:00.000Z" }, signal)).resolves.toEqual({ status: 200, counters: { sent: 3, failed: 1 } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://app.example.com/api/cron/pass/reminders");
    expect(init).toEqual({
      method: "POST",
      headers: { authorization: "Bearer s3cret", "content-type": "application/json" },
      body: JSON.stringify({ now: "2026-10-28T14:15:00.000Z" }),
      signal, cache: "no-store", redirect: "manual",
    });
  });

  it("14. a 200 whose body is not JSON, or JSON that is not an object, reads as counters: null", async () => {
    const signal = new AbortController().signal;
    for (const body of ["not json", "42", "null", "[1,2]"]) {
      const invoke = httpInvoke("https://app.example.com", "s3cret", (async () => response(200, body)) as unknown as typeof fetch);
      await expect(invoke("reminders", { now: "x" }, signal), body).resolves.toEqual({ status: 200, counters: null });
    }
  });

  it("14. a 504 or a 307 answer is its status with counters: null", async () => {
    const signal = new AbortController().signal;
    for (const status of [504, 307]) {
      const invoke = httpInvoke("https://app.example.com", "s3cret", (async () => response(status, "{\"sent\":1}")) as unknown as typeof fetch);
      await expect(invoke("reminders", { now: "x" }, signal), String(status)).resolves.toEqual({ status, counters: null });
    }
  });

  it("14. a fetch that rejects (timeout, refused connection) rejects: that is a no-answer", async () => {
    const invoke = httpInvoke("https://app.example.com", "s3cret", (async () => { throw new Error("aborted"); }) as unknown as typeof fetch);
    await expect(invoke("reminders", { now: "x" }, new AbortController().signal)).rejects.toThrow("aborted");
  });
});

describe("fanoutEnabled — the switch is exactly \"1\"", () => {
  it("15. \"1\" is on; \"true\", \" 1\", \"\" and unset are off (mutation: !!env.CRON_FANOUT -> FAILS)", () => {
    const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
    expect(fanoutEnabled(env({ CRON_FANOUT: "1" }))).toBe(true);
    for (const v of ["true", " 1", ""]) expect(fanoutEnabled(env({ CRON_FANOUT: v })), JSON.stringify(v)).toBe(false);
    expect(fanoutEnabled(env({}))).toBe(false);
  });
});
