import {
  markGoogleNeedsReconnect, setGoogleReconnectTask, stampGoogleChecked, addTask, completeTask, getAccountLanguage,
  type serviceDb,
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
 * version it read and opens one To-do. Every read that reached for Google logs ONE line, `google_busy_ms` included
 * (A5); a token, a busy time or Google's error text never appears in it.
 *
 * The access token lives in this module's memory only (D5), until 5 minutes before its `expires_in`. The picker
 * reads through a 60-second memo (D9); a submit check passes `fresh` and always asks Google.
 */
export const GOOGLE_BUSY_BUDGET_MS = 1_500;
export const GOOGLE_BUSY_MEMO_MS = 60_000;
const ACCESS_SLACK_MS = 5 * 60_000;
const MEMO_MAX = 500;
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
  | { outcome: "unchecked"; reason: string }
  | { outcome: "disconnected"; reason: string };

const accessTokens = new Map<string, { token: string; expiresAtMs: number }>();
const memo = new Map<string, { busy: Range[]; atMs: number }>();

/** Tests only: forget every memoised answer and access token. */
export function forgetGoogleBusyMemory(): void {
  accessTokens.clear();
  memo.clear();
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<Leg>((resolve) => {
    timer = setTimeout(() => { ctl.abort(); resolve({ read: { outcome: "unchecked", reason: "timeout" }, called: true }); }, GOOGLE_BUSY_BUDGET_MS);
  });
  let leg: Leg;
  try {
    leg = await Promise.race([
      askGoogle(db, accountId, day, window, opts.fresh, { cfg, fetch: deps.fetch ?? globalThis.fetch, clock, signal: ctl.signal }),
      budget,
    ]);
  } catch (e) {
    leg = { read: { outcome: "unchecked", reason: `bug_${e instanceof Error ? e.name : "unknown"}` }, called: true };
  } finally {
    clearTimeout(timer);
  }
  const { read, conn, called } = leg;
  if (called) {
    const reason = read.outcome === "unchecked" || read.outcome === "disconnected" ? ` reason=${read.reason}` : "";
    console.log(`google_busy account=${accountId} outcome=${read.outcome}${reason} google_busy_ms=${clock() - startedMs}`);
  }
  if (conn && (read.outcome === "checked" || read.outcome === "disconnected")) {
    const defer = deps.defer ?? defaultDefer;
    const job = read.outcome === "checked"
      ? () => stampGoogleChecked(db, conn.id, conn.version).then(() => undefined)
      : () => openReconnectTodo(db, accountId, conn, clock());
    defer(() => job().catch((e: unknown) => {
      console.error(`google calendar: account ${accountId}: after a busy read: ${e instanceof Error ? e.message : String(e)}`);
    }));
  }
  return read;
}

/** `called`: whether this read reached for Google at all (a memo hit, no connection or a needs-reconnect row did not). */
type Leg = { read: GoogleBusyRead; conn?: AccountConnection; called: boolean };

async function askGoogle(
  db: Db, accountId: string, day: string, window: { timeMin: Date; timeMax: Date }, fresh: boolean,
  x: { cfg: NonNullable<ReturnType<typeof googleCalendarConfig>>; fetch: typeof fetch; clock: () => number; signal: AbortSignal },
): Promise<Leg> {
  let conn: AccountConnection | null;
  try {
    conn = await readAccountConnection(db, accountId, [x.cfg.keys.current, x.cfg.keys.previous]);
  } catch {
    return { read: { outcome: "unchecked", reason: "connection_read" }, called: true };
  }
  if (!conn || conn.status !== "connected") return { read: { outcome: "off" }, called: false };
  if (!conn.token) return { read: { outcome: "unchecked", reason: "token_unopened" }, conn, called: true };

  const memoKey = `${conn.id}:${conn.version}:${day}`;
  const hit = memo.get(memoKey);
  if (!fresh && hit && x.clock() - hit.atMs < GOOGLE_BUSY_MEMO_MS) return { read: { outcome: "checked", busy: hit.busy }, called: false };

  const tokenKey = `${conn.id}:${conn.version}`;
  const deps = { fetch: x.fetch, signal: x.signal, now: x.clock() };
  let access = accessTokens.get(tokenKey);
  const cached = access !== undefined && access.expiresAtMs - ACCESS_SLACK_MS > x.clock();
  if (!cached) {
    const r = await refreshGoogleAccessToken(x.cfg, conn.token, deps);
    if (!r.ok) {
      accessTokens.delete(tokenKey);
      return { read: r.error === "invalid_grant" ? { outcome: "disconnected", reason: r.error } : { outcome: "unchecked", reason: r.error }, conn, called: true };
    }
    access = { token: r.accessToken, expiresAtMs: r.accessExpiresAt.getTime() };
    accessTokens.set(tokenKey, access);
  }
  const fb = await queryGoogleFreeBusy(access!.token, window, deps);
  if (!fb.ok) {
    if (fb.error === "http_401") accessTokens.delete(tokenKey);
    // A 401 on a token Google issued moments ago is a grant that no longer works (D11); on a cached one, the next
    // read refreshes.
    const read: GoogleBusyRead = fb.error === "http_401" && !cached
      ? { outcome: "disconnected", reason: fb.error } : { outcome: "unchecked", reason: fb.error };
    return { read, conn, called: true };
  }
  const busy = fb.busy.map((b) => ({ startsAt: b.start, endsAt: b.end }));
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value!);
  memo.set(memoKey, { busy, atMs: x.clock() });
  return { read: { outcome: "checked", busy }, conn, called: true };
}

/**
 * D12, after the answer: mark the version that was read needs_reconnect, and only when THIS read marked it, open
 * the one To-do (no contact, the account's language) and keep it on the row. A row that moved on meanwhile (a
 * reconnect) keeps nothing, so the To-do just opened is completed rather than left orphaned.
 */
async function openReconnectTodo(db: Db, accountId: string, conn: AccountConnection, nowMs: number): Promise<void> {
  if ((await markGoogleNeedsReconnect(db, conn.id, conn.version)) !== "marked") return;
  const locale = (await getAccountLanguage(db, accountId)) === "es" ? "es" : "en";
  const task = await addTask(db, accountId, {
    title: t(m, "calendar.googleBusy.reconnectTodo", locale), dueAt: new Date(nowMs).toISOString(),
  }, TODO_ACTOR, "system");
  if (!(await setGoogleReconnectTask(db, conn.id, conn.version, task.id))) {
    await completeTask(db, accountId, task.id, TODO_ACTOR, "system");
  }
}
