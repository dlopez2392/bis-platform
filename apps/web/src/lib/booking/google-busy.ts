import {
  markGoogleNeedsReconnect, setGoogleReconnectTask, stampGoogleChecked, addTask, completeGoogleReconnectTask,
  getAccountLanguage, type serviceDb,
} from "@bis/db";
import {
  googleCalendarConfig, readAccountConnection, refreshGoogleAccessToken, queryGoogleFreeBusy, type AccountConnection,
} from "@/lib/google/calendar-client";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Range } from "./slots";

/**
 * The owner's busy times on Google, for ONE account-zone day (S-22 slice 1, PR 4; plan
 * docs/superpowers/plans/2026-11-15-google-busy-blocks-slots.md D9-D13, Q1 = fail open). `readsFor`
 * (./availability.ts) runs this IN PARALLEL with the database reads and merges a `checked` answer into the booked
 * ranges, so the engine (./slots.ts) judges Google time exactly as it judges a booking.
 *
 * It never throws and never takes longer than GOOGLE_BUSY_BUDGET_MS: when Google cannot answer, the outcome is
 * `unchecked` and the caller offers what BIS alone would (owner answer Q1). `disconnected` (invalid_grant, or a 401
 * on a token just refreshed) offers the same and, AFTER the answer (`defer`), marks the row needs_reconnect on the
 * version it read and opens one To-do. A failed read carries `lastChecked`, this instance's last answer for the
 * same connection, version and day, so a submit can still honour the grid the picker showed (D11). Every read that
 * reached for Google logs ONE line, `google_busy_ms` included (A5); a token, a busy time or Google's error text
 * never appears in it.
 *
 * The access token lives in this module's memory only (D5), keyed by connection and version, until 5 minutes before
 * its `expires_in`. The picker reads through a 60-second memo keyed by connection, version and day (D9); a submit
 * check passes `fresh` and always asks Google.
 */
export const GOOGLE_BUSY_BUDGET_MS = 1_500;
export const GOOGLE_BUSY_MEMO_MS = 60_000;
const ACCESS_SLACK_MS = 5 * 60_000;
const MEMO_MAX = 500;
/** How often one instance re-tries opening the To-do of a marked row that has none (a To-do write that failed). */
const TODO_RETRY_MS = 10 * 60_000;
const TODO_ACTOR = "google-calendar";
const DAY_MS = 24 * 3600_000;

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;
type Db = ReturnType<typeof serviceDb>;

export type GoogleBusyDeps = {
  /** Google's transport. Defaults to the global fetch; every test injects its own. */
  fetch?: typeof fetch;
  env?: Env;
  /** Milliseconds now, for the memo, the token's expiry and google_busy_ms. */
  clock?: () => number;
  /** Runs work that must not delay the answer (the page passes next/server's `after`). */
  defer?: (job: () => Promise<void>) => void;
};

export type GoogleBusyRead =
  | { outcome: "off" }
  | { outcome: "checked"; busy: Range[] }
  | { outcome: "unchecked" | "disconnected"; reason: string; lastChecked: Range[] | null; askedGoogle: boolean };

const accessTokens = new Map<string, { token: string; expiresAtMs: number }>();
const memo = new Map<string, { busy: Range[]; atMs: number }>();
const todoTries = new Map<string, number>();
const connKey = (c: AccountConnection) => `${c.id}:${c.version}`;
const memoKey = (c: AccountConnection, day: string) => `${c.id}:${c.version}:${day}`;

/** Tests only: forget every memoised answer, access token and To-do retry. */
export function forgetGoogleBusyMemory(): void {
  accessTokens.clear();
  memo.clear();
  todoTries.clear();
}

/**
 * The instants Google is asked about for day `day` (`YYYY-MM-DD`, the account's zone): the day before through the
 * day after in EVERY zone (UTC-12 .. UTC+14), so it holds every range within the 240-minute buffer limit of the
 * day and every re-anchor point, across DST. Plain UTC arithmetic: no zone conversion, so no DST-gap failure.
 * Null for a string that is not a real date.
 */
export function googleBusyWindow(day: string): { timeMin: Date; timeMax: Date } | null {
  const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!hit) return null;
  const [y, mo, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  const base = Date.UTC(y, mo - 1, d);
  const back = new Date(base);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return { timeMin: new Date(base - DAY_MS - 14 * 3600_000), timeMax: new Date(base + 2 * DAY_MS + 12 * 3600_000) };
}

const defaultDefer = (job: () => Promise<void>) => { void job(); };
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What a leg learned: the outcome, the connection row once read (even if the budget then ran out), and whether
 *  it reached for Google at all (a memo hit, no connection or a needs-reconnect row did not). */
type Leg = { read: GoogleBusyRead; called: boolean };
type Seen = { conn?: AccountConnection; asked?: boolean };

/** The account's busy ranges for `day`, or why there are none. Never rejects. */
export async function readGoogleBusy(
  db: Db, accountId: string, day: string, opts: { fresh: boolean }, deps: GoogleBusyDeps = {},
): Promise<GoogleBusyRead> {
  const cfg = googleCalendarConfig(deps.env ?? process.env);
  const window = googleBusyWindow(day);
  if (!cfg || !window) return { outcome: "off" };
  const clock = deps.clock ?? Date.now;
  const startedMs = clock();
  const ctl = new AbortController();
  const seen: Seen = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<Leg>((resolve) => {
    timer = setTimeout(() => {
      ctl.abort();
      resolve({ read: { outcome: "unchecked", reason: "timeout", lastChecked: null, askedGoogle: seen.asked === true }, called: true });
    }, GOOGLE_BUSY_BUDGET_MS);
  });
  let leg: Leg;
  try {
    leg = await Promise.race([
      askGoogle(db, accountId, day, window, opts.fresh, seen, { cfg, fetch: deps.fetch ?? globalThis.fetch, clock, signal: ctl.signal }),
      budget,
    ]);
  } catch (e) {
    leg = { read: { outcome: "unchecked", reason: `bug_${e instanceof Error ? e.name : "unknown"}`, lastChecked: null, askedGoogle: false }, called: true };
  } finally {
    clearTimeout(timer);
  }
  const { called } = leg;
  let read = leg.read;
  const conn = seen.conn;
  if (conn && (read.outcome === "unchecked" || read.outcome === "disconnected")) {
    read = { ...read, lastChecked: memo.get(memoKey(conn, day))?.busy ?? null };
  }
  if (called) {
    const reason = read.outcome === "unchecked" || read.outcome === "disconnected" ? ` reason=${read.reason}` : "";
    console.log(`google_busy account=${accountId} outcome=${read.outcome}${reason} google_busy_ms=${clock() - startedMs}`);
  }
  const job = conn ? afterwards(db, accountId, conn, read, called, clock()) : null;
  if (job) {
    try {
      (deps.defer ?? defaultDefer)(() => job().catch((e: unknown) => {
        console.error(`google calendar: account ${accountId}: after a busy read: ${message(e)}`);
      }));
    } catch (e) {
      console.error(`google calendar: account ${accountId}: could not schedule the work after a busy read: ${message(e)}`);
    }
  }
  return read;
}

/** The work a read leaves for after the answer: stamp a checked read; mark and open the To-do on a disconnect; open
 *  a marked row's missing To-do (at most every TODO_RETRY_MS per instance). Null when there is none. */
function afterwards(
  db: Db, accountId: string, conn: AccountConnection, read: GoogleBusyRead, called: boolean, nowMs: number,
): (() => Promise<void>) | null {
  if (read.outcome === "checked" && called) return () => stampGoogleChecked(db, conn.id, conn.version).then(() => undefined);
  if (read.outcome === "disconnected") return () => openReconnectTodo(db, accountId, conn, nowMs, { mark: true });
  if (conn.status === "needs_reconnect" && conn.reconnectTaskId === null) {
    const tried = todoTries.get(connKey(conn));
    if (tried !== undefined && nowMs - tried < TODO_RETRY_MS) return null;
    todoTries.set(connKey(conn), nowMs);
    return () => openReconnectTodo(db, accountId, conn, nowMs, { mark: false });
  }
  return null;
}

async function askGoogle(
  db: Db, accountId: string, day: string, window: { timeMin: Date; timeMax: Date }, fresh: boolean, seen: Seen,
  x: { cfg: NonNullable<ReturnType<typeof googleCalendarConfig>>; fetch: typeof fetch; clock: () => number; signal: AbortSignal },
): Promise<Leg> {
  // askedGoogle (re-review I-1): a refresh or freeBusy request was actually made for a connected row whose token
  // opened. Only such a failure may loosen the submit grid (availability.ts); a database or key problem never does.
  const failed = (outcome: "unchecked" | "disconnected", reason: string): Leg =>
    ({ read: { outcome, reason, lastChecked: null, askedGoogle: seen.asked === true }, called: true });
  let conn: AccountConnection | null;
  try {
    conn = await readAccountConnection(db, accountId, [x.cfg.keys.current, x.cfg.keys.previous]);
  } catch {
    return failed("unchecked", "connection_read");
  }
  if (!conn) return { read: { outcome: "off" }, called: false };
  seen.conn = conn;
  if (conn.status !== "connected") return { read: { outcome: "off" }, called: false };
  if (!conn.token) return failed("unchecked", "token_unopened");

  const hit = memo.get(memoKey(conn, day));
  if (!fresh && hit && x.clock() - hit.atMs < GOOGLE_BUSY_MEMO_MS) return { read: { outcome: "checked", busy: hit.busy }, called: false };

  const deps = { fetch: x.fetch, signal: x.signal, now: x.clock() };
  seen.asked = true; // from here on, every failure is Google's (a refresh or freeBusy request is made next)
  let access = accessTokens.get(connKey(conn));
  const cached = access !== undefined && access.expiresAtMs - ACCESS_SLACK_MS > x.clock();
  if (!cached) {
    const r = await refreshGoogleAccessToken(x.cfg, conn.token, deps);
    if (!r.ok) {
      accessTokens.delete(connKey(conn));
      return failed(r.error === "invalid_grant" ? "disconnected" : "unchecked", r.error);
    }
    access = { token: r.accessToken, expiresAtMs: r.accessExpiresAt.getTime() };
    accessTokens.set(connKey(conn), access);
  }
  const fb = await queryGoogleFreeBusy(access!.token, window, deps);
  if (!fb.ok) {
    if (fb.error === "http_401") accessTokens.delete(connKey(conn));
    // A 401 on a token Google issued moments ago is a grant that no longer works (D11); on a cached one, the next
    // read refreshes.
    return failed(fb.error === "http_401" && !cached ? "disconnected" : "unchecked", fb.error);
  }
  const busy = fb.busy.map((b) => ({ startsAt: b.start, endsAt: b.end }));
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value!);
  memo.set(memoKey(conn, day), { busy, atMs: x.clock() });
  return { read: { outcome: "checked", busy }, called: true };
}

/**
 * D12, after the answer. With `mark`: mark the version that was read needs_reconnect, and go on only when THIS read
 * marked it. Without (a marked row whose To-do never opened): go straight on. Then open the one To-do (no contact,
 * the account's language) and keep it on the row by compare-and-set; a To-do the row would not keep (a reconnect,
 * or another instance's To-do, landed meanwhile) or whose set FAILED is completed at once, so none is orphaned.
 */
async function openReconnectTodo(
  db: Db, accountId: string, conn: AccountConnection, nowMs: number, opts: { mark: boolean },
): Promise<void> {
  if (opts.mark && (await markGoogleNeedsReconnect(db, conn.id, conn.version)) !== "marked") return;
  const locale = (await getAccountLanguage(db, accountId)) === "es" ? "es" : "en";
  const task = await addTask(db, accountId, {
    title: t(m, "calendar.googleBusy.reconnectTodo", locale), dueAt: new Date(nowMs).toISOString(),
  }, TODO_ACTOR, "system");
  let kept = false;
  try {
    kept = await setGoogleReconnectTask(db, conn.id, conn.version, task.id);
  } finally {
    if (!kept) await completeGoogleReconnectTask(db, accountId, task.id);
  }
}
