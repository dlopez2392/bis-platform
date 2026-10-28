import type { PassCounters } from "./context";
import type { HeartbeatOutcome } from "./harness";

/**
 * F-196: the fan-out tick. With `CRON_FANOUT=1` (and `APP_ORIGIN` set) the
 * cron route stops running every pass in its own invocation and becomes a
 * DISPATCHER: it walks `PLAN` and POSTs each node to its own pass route,
 * starting a node only when its predecessors allow. This module is the plan
 * and the executor; it imports only types (no `@bis/db`, no registry), so the
 * routes that use it carry no new mock surface.
 *
 * Why a graph and not the registry's straight line: the registry's order
 * encodes a handful of real dependencies (the release pass before every
 * recipe it can release, follow-ups before review requests before referral
 * asks, the reports and the alert pass last) and a great deal of incidental
 * sequence. The plan keeps the first and drops the second, so a slow site
 * pull no longer delays a reminder.
 */

/** The pass route's own `maxDuration`. */
export const PASS_ROUTE_MAX_S = 90;
/** The jobs drain route's own `maxDuration`. */
export const JOBS_DRAIN_MAX_S = 300;
/** The dispatcher's (`/api/cron/reminders`) `maxDuration` under fan-out. */
export const DISPATCHER_MAX_S = 800;
/** The in-process tick's budget: what every pass together must fit when the switch is off. */
export const LEGACY_TICK_CEILING_S = 300;
/** How long past a node's ceiling the dispatcher waits for its answer before calling it no answer. */
export const ANSWER_GRACE_S = 5;
/** Headroom the dispatcher keeps beyond the plan's longest path. */
export const DISPATCH_SLACK_S = 20;
export const JOBS_DRAIN_KEY = "jobsDrain";

/**
 * When a node may start, given how its predecessors ended:
 *  - settled: once every predecessor ANSWERED (any status) or was skipped.
 *  - completed: only when every predecessor answered 200 with readable
 *    counters; otherwise the node is skipped. For a dependency on what the
 *    predecessor WROTE (follow-ups stamp, review requests read it).
 *  - released (Spec correction 11): as `completed`, but a failure BLOCKS
 *    rather than skips. For the recipes after the release pass: a release
 *    that answered 502, or 200 unreadably, or not at all, may still be
 *    sending, and a recipe running beside it could send one subject twice.
 *  - regardless: once every predecessor is decided, however it ended.
 * In every rule but `regardless`, a predecessor that gave NO answer, or was
 * itself blocked, blocks: it may still be running (Spec correction 2).
 */
export type WaitRule = "settled" | "completed" | "released" | "regardless";
export type PlanNode = {
  readonly key: string;
  readonly after: readonly string[];
  readonly rule: WaitRule;
  readonly ceilingS: number;
};

const n = (key: string, after: readonly string[], rule: WaitRule = "settled", ceilingS = PASS_ROUTE_MAX_S): PlanNode => ({ key, after, rule, ceilingS });
const R = ["releaseHeld"] as const;
const rel = (key: string): PlanNode => n(key, R, "released");
const HEAD: readonly PlanNode[] = [
  n("billingPause", []),
  n("releaseHeld", ["billingPause"]),
  n("cancelNotices", ["billingPause"]),
  rel("reminders"), rel("followups"),
  n("reviewRequests", ["followups"], "completed"),
  n("referralAsks", ["reviewRequests"], "completed"),
  rel("noShowNudges"), rel("smsReminders"), rel("appointmentConfirms"),
  n("reactivations", ["cancelNotices", "reminders", "referralAsks", "noShowNudges", "smsReminders", "appointmentConfirms"]),
  rel("quoteFollowups"),
  n("siteTraffic", ["billingPause"]), n("documentsSweep", ["billingPause"]),
  n("documentsScan", ["documentsSweep"]), n("documentsExpiry", ["documentsScan"]),
  n("weeklyClientReport", ["billingPause"]), n("weeklyAgencyReport", ["weeklyClientReport"]),
  n(JOBS_DRAIN_KEY, ["billingPause"], "settled", JOBS_DRAIN_MAX_S),
];
// The usage report follows every sender (a text sent this tick reaches Stripe
// this tick); the alert pass follows everything, so it reads this tick's beats.
const usage = n("usageReport", HEAD.map((x) => x.key), "regardless");
export const PLAN: readonly PlanNode[] = [...HEAD, usage, n("opsWatch", [...HEAD.map((x) => x.key), usage.key], "regardless")];

/** The switch: exactly "1" is on. Not "true", not " 1". */
export function fanoutEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CRON_FANOUT === "1";
}

/**
 * The longest chain of (ceiling + grace) through the plan: the worst case the
 * dispatcher waits when every node runs to its ceiling. A node's path is its
 * own cost plus the LONGEST of its predecessors' paths (they run in parallel).
 */
export function longestPathS(plan: readonly PlanNode[], graceS: number = ANSWER_GRACE_S): number {
  const byKey = new Map(plan.map((x) => [x.key, x]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const path = (key: string): number => {
    const known = memo.get(key);
    if (known !== undefined) return known;
    const nd = byKey.get(key);
    if (!nd) throw new Error(`fan-out plan: unknown predecessor ${key}`);
    if (visiting.has(key)) throw new Error(`fan-out plan: cycle through ${key}`);
    visiting.add(key);
    const longestBefore = Math.max(0, ...nd.after.map(path));
    visiting.delete(key);
    const total = longestBefore + nd.ceilingS + graceS;
    memo.set(key, total);
    return total;
  };
  return Math.max(0, ...plan.map((x) => path(x.key)));
}

/** A pass route's answer: its HTTP status, and its counters when it answered 200 with a readable body. */
export type Answer = { status: number; counters: PassCounters | null };
export type Invoke = (key: string, body: { now: string }, signal: AbortSignal) => Promise<Answer>;
export type FanoutBeat = (key: string, outcome: HeartbeatOutcome) => Promise<void>;

type Outcome =
  | { kind: "answered"; status: number; counters: PassCounters | null }
  | { kind: "noAnswer"; error: string }
  | { kind: "skipped" }    // a `completed` predecessor did not answer 200
  // Some ancestor gave no answer (or, for a `released` node, the release pass
  // did not complete) and may still be running. `cause` is that ancestor's key,
  // never a blocked node's, so a heartbeat can name where the tick stopped.
  | { kind: "blocked"; cause: string };

/** A 200's body is readable only as a plain object. ONE reading, shared by the
 *  release rule and the reported counters, so an answer the JSON calls
 *  `unreadable` can never release the recipes (it fails closed). */
const readable = (c: unknown): c is PassCounters => c !== null && typeof c === "object" && !Array.isArray(c);
const isCompleted = (p: Outcome) => p.kind === "answered" && p.status === 200 && readable(p.counters);

/** The key of the ancestor that blocks `node`: a predecessor that gave no
 *  answer, a blocked predecessor's own cause, or (for `released`) the
 *  predecessor that did not complete. */
function blockCause(node: PlanNode, done: ReadonlyMap<string, Outcome>): string {
  for (const k of node.after) {
    const p = done.get(k)!;
    if (p.kind === "noAnswer") return k;
    if (p.kind === "blocked") return p.cause;
  }
  return node.after.find((k) => !isCompleted(done.get(k)!))!;
}

function decide(node: PlanNode, done: ReadonlyMap<string, Outcome>): "wait" | "start" | "skipped" | "blocked" {
  const preds = node.after.map((k) => done.get(k));
  if (preds.some((p) => p === undefined)) return "wait";
  if (node.rule === "regardless") return "start";
  if (preds.some((p) => p!.kind === "noAnswer" || p!.kind === "blocked")) return "blocked";
  if (node.rule === "released" && !preds.every((p) => isCompleted(p!))) return "blocked";
  if (node.rule === "completed" && !preds.every((p) => isCompleted(p!))) return "skipped";
  return "start";
}

/**
 * Why a `released` node never started, in the words its heartbeat carries.
 * Every `released` node waits on releaseHeld ALONE (fanout.test.ts case 4 pins
 * `after` to exactly ["releaseHeld"]), so "the release pass" names its one
 * predecessor. Four causes: it answered non-200, answered 200 unreadably, did
 * not answer, or was itself never started (an ancestor of it, named, did not
 * answer).
 */
function notStartedReason(node: PlanNode, done: ReadonlyMap<string, Outcome>): string {
  const cause = node.after.map((k) => done.get(k)!).find((p) => !isCompleted(p))!;
  switch (cause.kind) {
    case "answered":
      return cause.status === 200
        ? "not started: the release pass answered unreadably"
        : `not started: the release pass answered HTTP ${cause.status}`;
    case "noAnswer":
      return "not started: the release pass did not answer";
    case "blocked":
      // `cause.cause` is always a node that answered or did not (blockCause never names a blocked one).
      return `not started: the release pass was not started because the ${cause.cause} pass ${describe(done.get(cause.cause)!)}`;
    case "skipped":
      return "not started: the release pass was skipped";
  }
}

function describe(o: Outcome): string {
  if (o.kind === "answered") return o.status === 200 ? "answered unreadably" : `answered HTTP ${o.status}`;
  return "did not answer";
}

function countersOf(o: Outcome): PassCounters {
  switch (o.kind) {
    case "answered":
      if (o.status !== 200) return { errored: 1 };
      return readable(o.counters) ? o.counters : { unreadable: 1 };
    case "noAnswer":
      return { errored: 1, noAnswer: 1 };
    default:
      return { notStarted: 1 };
  }
}

/**
 * Walks the plan. Every node is invoked with the SAME `{ now }` (one tick, one
 * now), and without awaiting, so independent branches run side by side. A
 * finishing node's failure heartbeat is AWAITED before the node counts as done,
 * and a `released` node that is blocked writes its own failed heartbeat before
 * it counts as done (plan re-review N1), in its own in-flight task so the scan
 * goes on meanwhile: either way the write lands before any
 * `regardless` node (the usage report, then the alert pass that reads these
 * rows) can start. A 200 writes nothing here: the pass route's own `runPass`
 * wrote that pass's heartbeat. `cron.tick` is written once, after every node
 * is decided. A heartbeat writer that throws never fails the tick.
 */
export async function runFanout(input: {
  plan: readonly PlanNode[]; now: Date; invoke: Invoke; beat: FanoutBeat;
}): Promise<Record<string, PassCounters>> {
  const { plan, now, invoke, beat } = input;
  const body = { now: now.toISOString() };
  const done = new Map<string, Outcome>();
  const inFlight = new Map<string, Promise<void>>();

  const safeBeat = async (key: string, outcome: HeartbeatOutcome): Promise<void> => {
    try {
      await beat(key, outcome);
    } catch (e) {
      console.error(`heartbeat ${key} not written: ${String(e)}`);
    }
  };

  const start = (node: PlanNode): Promise<void> => (async () => {
    let outcome: Outcome;
    try {
      const signal = AbortSignal.timeout((node.ceilingS + ANSWER_GRACE_S) * 1000);
      const answer = await invoke(node.key, body, signal);
      outcome = { kind: "answered", status: answer.status, counters: answer.counters };
      if (answer.status !== 200) {
        await safeBeat(`cron.pass.${node.key}`, { ok: false, error: `the pass's function answered HTTP ${answer.status}` });
      }
    } catch (e) {
      outcome = { kind: "noAnswer", error: String(e) };
      await safeBeat(`cron.pass.${node.key}`, { ok: false, error: `the pass's function did not answer: ${String(e)}` });
    }
    done.set(node.key, outcome);
    inFlight.delete(node.key);
  })();

  while (done.size < plan.length) {
    let changed = false;
    for (const node of plan) {
      if (done.has(node.key) || inFlight.has(node.key)) continue;
      const decision = decide(node, done);
      if (decision === "wait") continue;
      changed = true;
      if (decision === "start") {
        inFlight.set(node.key, start(node));
        continue;
      }
      if (decision === "blocked" && node.rule === "released") {
        // Its own task, like a started node's, so a slow heartbeat write never
        // stalls the scan for unrelated branches; done only once it landed.
        const error = notStartedReason(node, done);
        const cause = blockCause(node, done);
        inFlight.set(node.key, (async () => {
          await safeBeat(`cron.pass.${node.key}`, { ok: false, error });
          done.set(node.key, { kind: "blocked", cause });
          inFlight.delete(node.key);
        })());
        continue;
      }
      done.set(node.key, decision === "blocked" ? { kind: "blocked", cause: blockCause(node, done) } : { kind: "skipped" });
    }
    if (changed) continue;
    if (inFlight.size === 0) {
      const stuck = plan.filter((x) => !done.has(x.key)).map((x) => x.key);
      throw new Error(`fan-out plan cannot finish (unknown predecessor or cycle): ${stuck.join(", ")}`);
    }
    await Promise.race(inFlight.values());
  }

  await safeBeat("cron.tick", { ok: true });
  const results: Record<string, PassCounters> = {};
  for (const node of plan) results[node.key] = countersOf(done.get(node.key)!);
  return results;
}

/**
 * The production `Invoke`: one POST to the node's pass route, with the bearer.
 * `redirect: "manual"`, so a redirect is a non-200 answer and the bearer never
 * follows it to another host. A 200 whose body is not a JSON object reads as
 * `counters: null` (an unreadable answer, which is NOT completed). A rejected
 * fetch (the timeout, a refused connection) rejects: the executor calls that
 * no answer. The secret is never logged or returned.
 */
export function httpInvoke(origin: string, secret: string, fetchImpl: typeof fetch = fetch): Invoke {
  return async (key, body, signal) => {
    const res = await fetchImpl(`${origin}/api/cron/pass/${key}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal, cache: "no-store", redirect: "manual",
    });
    if (res.status !== 200) return { status: res.status, counters: null };
    let counters: PassCounters | null = null;
    try {
      const parsed: unknown = await res.json();
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) counters = parsed as PassCounters;
    } catch {
      counters = null;
    }
    return { status: 200, counters };
  };
}
