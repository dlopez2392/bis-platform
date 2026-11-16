import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * S-22 slice 1, PR 4 (plan docs/superpowers/plans/2026-11-15-google-busy-blocks-slots.md, D9-D15, Q1 = fail open):
 * Google busy times block slots, through the SAME readers every caller uses. The database readers are mocked; Google
 * is a fake `fetch` that honours the window it is asked for (it returns only busy time inside timeMin..timeMax,
 * clipped, as freeBusy does), so a window too narrow loses the block and the window tests go red. Nothing here
 * reaches the network: the global fetch throws.
 */
const dbm = vi.hoisted(() => ({
  booked: vi.fn(), status: vi.fn(), closed: vi.fn(), sealed: vi.fn(), mark: vi.fn(), setTask: vi.fn(),
  stamp: vi.fn(), addTask: vi.fn(), completeReconnect: vi.fn(), language: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listBookedRanges: (...a: unknown[]) => dbm.booked(...a),
  getBusinessStatusRow: (...a: unknown[]) => dbm.status(...a),
  listClosedDaysFrom: (...a: unknown[]) => dbm.closed(...a),
  readGoogleConnectionSealed: (...a: unknown[]) => dbm.sealed(...a),
  markGoogleNeedsReconnect: (...a: unknown[]) => dbm.mark(...a),
  setGoogleReconnectTask: (...a: unknown[]) => dbm.setTask(...a),
  stampGoogleChecked: (...a: unknown[]) => dbm.stamp(...a),
  addTask: (...a: unknown[]) => dbm.addTask(...a),
  completeGoogleReconnectTask: (...a: unknown[]) => dbm.completeReconnect(...a),
  getAccountLanguage: (...a: unknown[]) => dbm.language(...a),
}));

import type { CalendarRow, serviceDb } from "@bis/db";
import { computeDaySlots, bookableSlot, moveSlots, movableSlot } from "./availability";
import { googleBusyWindow, forgetGoogleBusyMemory, GOOGLE_BUSY_BUDGET_MS } from "./google-busy";
import { sealGoogleToken, googleTokenKey } from "@/lib/google/token-seal";

const KEY = Buffer.alloc(32, 9).toString("base64url");
const ENV = {
  GOOGLE_CALENDAR_CLIENT_ID: "client-123.apps.googleusercontent.com",
  GOOGLE_CALENDAR_CLIENT_SECRET: "secret_value_abc",
  GOOGLE_CALENDAR_TOKEN_KEY: KEY,
  GOOGLE_CALENDAR_REDIRECT_URI: "http://localhost:3000/api/google-calendar/callback",
};
const REFRESH = "1//0gREFRESH-token-value_abcdefghij";
const ACCESS = "ya29.ACCESS-token-value_abcdefghij";
const ACCOUNT = "a1a1a1a1-0000-4000-8000-000000000001";
const CONN = "11111111-1111-4111-8111-111111111111";
const db = {} as unknown as ReturnType<typeof serviceDb>;

function sealedRow(over: {
  version?: number; status?: "connected" | "needs_reconnect"; accountId?: string; id?: string; refresh?: string;
  key?: string; reconnectTaskId?: string | null;
} = {}) {
  const version = over.version ?? 3;
  const accountId = over.accountId ?? ACCOUNT;
  const id = over.id ?? CONN;
  const { sealed, keyVersion } = sealGoogleToken(over.refresh ?? REFRESH, { accountId, id, version }, googleTokenKey(over.key ?? KEY)!);
  return {
    id, account_id: accountId, version, status: over.status ?? "connected", google_email: "owner@example.com",
    refresh_token_sealed: sealed, key_version: keyVersion, reconnect_task_id: over.reconnectTaskId ?? null,
  };
}

type Busy = [string, string];
type Google = {
  refresh?: "ok" | "invalid_grant" | "hang";
  freebusy?: "ok" | "hang" | "network" | 429 | 500 | 401 | "errors" | "unparseable";
  busy?: Busy[];
};
/** A fake Google: the token endpoint and freeBusy. Records every call's URL and the windows asked for. */
function fakeGoogle(g: Google) {
  const calls: { url: string; window?: { timeMin: string; timeMax: string }; signal?: AbortSignal }[] = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      calls.push({ url, signal: init?.signal ?? undefined });
      if (g.refresh === "hang") return new Promise<Response>(() => {});
      if (g.refresh === "invalid_grant") return json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
      return json(200, { access_token: ACCESS, expires_in: 3599, token_type: "Bearer" });
    }
    if (url === "https://www.googleapis.com/calendar/v3/freeBusy") {
      const body = JSON.parse(String(init?.body)) as { timeMin: string; timeMax: string };
      calls.push({ url, window: { timeMin: body.timeMin, timeMax: body.timeMax }, signal: init?.signal ?? undefined });
      const mode = g.freebusy ?? "ok";
      if (mode === "hang") return new Promise<Response>(() => {});
      if (mode === "network") throw new TypeError("fetch failed");
      if (typeof mode === "number") return json(mode, { error: { code: mode, message: "nope", status: "X" } });
      const min = Date.parse(body.timeMin);
      const max = Date.parse(body.timeMax);
      const busy = (g.busy ?? [])
        .filter(([s, e]) => Date.parse(s) < max && Date.parse(e) > min)
        .map(([s, e]) => ({
          start: new Date(Math.max(Date.parse(s), min)).toISOString(), end: new Date(Math.min(Date.parse(e), max)).toISOString(),
        }));
      if (mode === "errors") return json(200, { calendars: { primary: { busy, errors: [{ domain: "global", reason: "internalError" }] } } });
      if (mode === "unparseable") return json(200, { calendars: { primary: { busy: [...busy, { start: "tomorrow-ish", end: "2027-06-01T11:00:00Z" }] } } });
      return json(200, { kind: "calendar#freeBusy", calendars: { primary: { busy } } });
    }
    throw new Error(`unexpected URL ${url}`);
  });
  const urls = () => calls.map((c) => c.url);
  return { fetch: fn as unknown as typeof fetch, calls, urls };
}

const everyDay = (from: string, to: string) =>
  Object.fromEntries(["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, [[from, to]]]));
const cal = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "cal1", account_id: ACCOUNT, public_id: "p1", enabled: true,
  slot_duration_minutes: 60, buffer_minutes: 0, min_notice_hours: 0, max_advance_days: 30,
  open_hours: everyDay("09:00", "17:00"), notify_emails: [], ...over,
}) as unknown as CalendarRow;

const iso = (rs: { startsAt: Date }[]) => rs.map((r) => r.startsAt.toISOString());
const DAY = "2027-06-01"; // a Tuesday
const NOW = new Date("2027-06-01T00:00:00Z");
const HOURS_9_TO_16 = [9, 10, 11, 12, 13, 14, 15, 16].map((h) => `${DAY}T${String(h).padStart(2, "0")}:00:00.000Z`);

let lines: string[];
beforeEach(() => {
  forgetGoogleBusyMemory();
  for (const f of Object.values(dbm)) f.mockReset();
  dbm.booked.mockResolvedValue([]);
  dbm.status.mockResolvedValue(null);
  dbm.closed.mockResolvedValue([]);
  dbm.sealed.mockResolvedValue(sealedRow());
  dbm.mark.mockResolvedValue("marked");
  dbm.setTask.mockResolvedValue(true);
  dbm.stamp.mockResolvedValue(true);
  dbm.addTask.mockResolvedValue({ id: "task-1" });
  dbm.completeReconnect.mockResolvedValue(true);
  dbm.language.mockResolvedValue("en");
  lines = [];
  for (const k of ["log", "warn", "error", "info"] as const) {
    vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(" ")); });
  }
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
vi.stubGlobal("fetch", () => { throw new Error("a test reached the real network"); });

/** The deferred work (D12's mark and To-do, the checked stamp), run only when the test says so. */
function deferred() {
  const jobs: (() => Promise<void>)[] = [];
  return { defer: (job: () => Promise<void>) => { jobs.push(job); }, run: async () => { for (const j of jobs.splice(0)) await j(); }, jobs };
}

describe("busy on Google blocks slots (D10: merged into booked, buffer and all)", () => {
  it("control: with Google dormant the day is every hour 09:00-16:00, and nothing is read for Google", async () => {
    const g = fakeGoogle({ busy: [[`${DAY}T10:00:00Z`, `${DAY}T11:00:00Z`]] });
    expect(iso(await computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: g.fetch, env: {} }))).toEqual(HOURS_9_TO_16);
    expect(g.calls).toEqual([]);
    expect(dbm.sealed).not.toHaveBeenCalled();
  });

  it("a 10:00-11:00 busy block hides 10:00 (probe: drop the merge -> FAILS)", async () => {
    const g = fakeGoogle({ busy: [[`${DAY}T10:00:00Z`, `${DAY}T11:00:00Z`]] });
    const starts = iso(await computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: g.fetch, env: ENV }));
    expect(starts).toEqual(HOURS_9_TO_16.filter((s) => !s.includes("T10:")));
  });

  it("with a 15-minute buffer and 60-minute slots it hides 09:00 too, and the day re-anchors at 11:15", async () => {
    const g = fakeGoogle({ busy: [[`${DAY}T10:00:00Z`, `${DAY}T11:00:00Z`]] });
    const starts = iso(await computeDaySlots(db, cal({ buffer_minutes: 15 }), "UTC", NOW, DAY, { fetch: g.fetch, env: ENV }));
    expect(starts).toEqual(["11:15", "12:15", "13:15", "14:15", "15:15"].map((t) => `${DAY}T${t}:00.000Z`));
  });

  it("every slot computeDaySlots offers passes bookableSlot under the same Google answer; the blocked ones do not", async () => {
    const g = fakeGoogle({ busy: [[`${DAY}T10:00:00Z`, `${DAY}T11:00:00Z`]] });
    const c = cal({ buffer_minutes: 15 });
    const offered = await computeDaySlots(db, c, "UTC", NOW, DAY, { fetch: g.fetch, env: ENV });
    expect(offered.length).toBe(5);
    for (const s of offered) {
      expect(await bookableSlot(db, c, "UTC", NOW, s.startsAt, { fetch: g.fetch, env: ENV }), s.startsAt.toISOString()).toEqual(s);
    }
    for (const t of ["09:00", "10:00", "11:00"]) {
      expect(await bookableSlot(db, c, "UTC", NOW, new Date(`${DAY}T${t}:00Z`), { fetch: g.fetch, env: ENV }), t).toBeNull();
    }
  });

  it("the move page's picker and its submit see Google too", async () => {
    const g = fakeGoogle({ busy: [[`${DAY}T10:00:00Z`, `${DAY}T11:00:00Z`]] });
    const moving = { id: "own", startsAt: new Date(`${DAY}T15:00:00Z`), endsAt: new Date(`${DAY}T16:00:00Z`) };
    const starts = iso(await moveSlots(db, cal(), "UTC", NOW, moving, DAY, { fetch: g.fetch, env: ENV }));
    expect(starts).toEqual(HOURS_9_TO_16.filter((s) => !/T1[05]:/.test(s)));
    expect(await movableSlot(db, cal(), "UTC", NOW, moving, new Date(`${DAY}T10:00:00Z`), { fetch: g.fetch, env: ENV })).toBeNull();
    expect(await movableSlot(db, cal(), "UTC", NOW, moving, new Date(`${DAY}T11:00:00Z`), { fetch: g.fetch, env: ENV })).not.toBeNull();
  });

  it("the submit asks Google afresh and refuses a time busy since the picker loaded, though the memo still says free (probe: read the memo at submit -> FAILS)", async () => {
    const g = fakeGoogle({ busy: [] });
    const deps = { fetch: g.fetch, env: ENV };
    expect(iso(await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps))).toContain(`${DAY}T10:00:00.000Z`);
    g.calls.length = 0;
    // The owner adds a 10:00 event on Google. Within the minute the picker still answers from the memo ...
    const later = fakeGoogle({ busy: [[`${DAY}T10:00:00Z`, `${DAY}T11:00:00Z`]] });
    deps.fetch = later.fetch;
    expect(iso(await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps))).toContain(`${DAY}T10:00:00.000Z`);
    expect(later.calls).toEqual([]);
    // ... but the submit reads Google again and refuses it.
    expect(await bookableSlot(db, cal(), "UTC", NOW, new Date(`${DAY}T10:00:00Z`), deps)).toBeNull();
    expect(later.urls()).toContain("https://www.googleapis.com/calendar/v3/freeBusy");
  });

  it("the memo lasts a minute: after it, the picker asks Google again", async () => {
    let clock = 1_000_000;
    const g = fakeGoogle({ busy: [] });
    const deps = { fetch: g.fetch, env: ENV, clock: () => clock };
    await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps);
    clock += 59_000;
    await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps);
    expect(g.urls().filter((u) => u.endsWith("/freeBusy"))).toHaveLength(1);
    clock += 2_000;
    await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps);
    expect(g.urls().filter((u) => u.endsWith("/freeBusy"))).toHaveLength(2);
    // The access token is kept in memory between reads: one refresh for all three.
    expect(g.urls().filter((u) => u.endsWith("/token"))).toHaveLength(1);
  });

  it("a day outside the horizon never asks Google", async () => {
    const g = fakeGoogle({ busy: [] });
    expect(await computeDaySlots(db, cal({ max_advance_days: 2 }), "UTC", NOW, "2027-07-01", { fetch: g.fetch, env: ENV })).toEqual([]);
    expect(await computeDaySlots(db, cal(), "UTC", NOW, "2027-05-20", { fetch: g.fetch, env: ENV })).toEqual([]);
    expect(g.calls).toEqual([]);
  });

  it("a checked read is stamped after the answer, on the version it read", async () => {
    const g = fakeGoogle({ busy: [] });
    const d = deferred();
    await computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: g.fetch, env: ENV, defer: d.defer });
    expect(dbm.stamp).not.toHaveBeenCalled();
    await d.run();
    expect(dbm.stamp).toHaveBeenCalledWith(db, CONN, 3);
  });
});

describe("when Google cannot answer, the day is offered as BIS alone would (Q1: fail open) and ONE line is logged", () => {
  const cases: [string, Google][] = [
    ["a 429", { freebusy: 429 }],
    ["a 500", { freebusy: 500 }],
    ["a network failure", { freebusy: "network" }],
    ["an errors[] entry inside a 200", { freebusy: "errors", busy: [[`${DAY}T10:00:00Z`, `${DAY}T11:00:00Z`]] }],
    ["an unparseable instant (probe: pass Google's instants unvalidated -> FAILS)", { freebusy: "unparseable", busy: [[`${DAY}T10:00:00Z`, `${DAY}T11:00:00Z`]] }],
  ];
  for (const [what, google] of cases) {
    it(`${what}: today's slots, bookable at submit too, and one line naming the account and the outcome (probe: fail closed -> FAILS)`, async () => {
      const g = fakeGoogle(google);
      const deps = { fetch: g.fetch, env: ENV, defer: deferred().defer };
      expect(iso(await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps))).toEqual(HOURS_9_TO_16);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^google_busy account=a1a1a1a1-0000-4000-8000-000000000001 outcome=(unchecked|disconnected) .*google_busy_ms=\d+$/);
      expect(lines.join("\n")).not.toContain(ACCESS);
      expect(lines.join("\n")).not.toContain(REFRESH);
      expect(await bookableSlot(db, cal(), "UTC", NOW, new Date(`${DAY}T10:00:00Z`), deps)).not.toBeNull();
    });
  }

  it("a failed read of the connection row is unchecked too, never a failed page", async () => {
    dbm.sealed.mockRejectedValue(new Error("readGoogleConnectionSealed failed: boom"));
    const g = fakeGoogle({ busy: [] });
    expect(iso(await computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: g.fetch, env: ENV }))).toEqual(HOURS_9_TO_16);
    expect(lines).toEqual([expect.stringMatching(/^google_busy account=a1a1a1a1-0000-4000-8000-000000000001 outcome=unchecked reason=connection_read /)]);
  });

  it("a hung Google answers unchecked inside the 1,500 ms budget, and the request is aborted (fake timers)", async () => {
    vi.useFakeTimers();
    expect(GOOGLE_BUSY_BUDGET_MS).toBe(1_500);
    const g = fakeGoogle({ freebusy: "hang" });
    let settled: string[] | null = null;
    const pending = computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: g.fetch, env: ENV }).then((r) => { settled = iso(r); });
    await vi.advanceTimersByTimeAsync(1_499);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toEqual(HOURS_9_TO_16);
    expect(lines).toEqual([expect.stringMatching(/^google_busy account=a1a1a1a1-0000-4000-8000-000000000001 outcome=unchecked reason=timeout google_busy_ms=1500$/)]);
    expect(g.calls.find((c) => c.url.endsWith("/freeBusy"))!.signal!.aborted).toBe(true);
  });

  it("the Google leg starts beside the database reads, not after them, so a caller waits max(database, Google) (probe: await it after -> FAILS)", async () => {
    let release!: (v: unknown[]) => void;
    dbm.booked.mockImplementation(() => new Promise((r) => { release = r; }));
    const g = fakeGoogle({ busy: [] });
    const pending = computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: g.fetch, env: ENV });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(dbm.sealed).toHaveBeenCalledTimes(1);
    release([]);
    await pending;
  });

  it("a hung token refresh is held to the same budget", async () => {
    vi.useFakeTimers();
    const g = fakeGoogle({ refresh: "hang" });
    const pending = computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: g.fetch, env: ENV });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(iso(await pending)).toEqual(HOURS_9_TO_16);
  });
});

describe("invalid_grant (D12): mark once, ONE To-do, and no more Google calls", () => {
  it("marks the version it read and opens one To-do in the account's language, after the answer; later reads never call Google", async () => {
    const g = fakeGoogle({ refresh: "invalid_grant" });
    const d = deferred();
    const deps = { fetch: g.fetch, env: ENV, defer: d.defer };
    expect(iso(await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps))).toEqual(HOURS_9_TO_16);
    expect(lines).toEqual([expect.stringMatching(/^google_busy account=a1a1a1a1-0000-4000-8000-000000000001 outcome=disconnected /)]);
    expect(dbm.mark).not.toHaveBeenCalled(); // nothing delays the answer
    await d.run();
    expect(dbm.mark.mock.calls).toEqual([[db, CONN, 3]]);
    expect(dbm.addTask).toHaveBeenCalledTimes(1);
    expect(dbm.addTask.mock.calls[0]!.slice(1, 3)).toEqual([ACCOUNT, { title: "Reconnect your Google Calendar", dueAt: expect.any(String) }]);
    expect(dbm.setTask.mock.calls).toEqual([[db, CONN, 3, "task-1"]]);
    expect(dbm.completeReconnect).not.toHaveBeenCalled();

    // The row now says so: every later read skips Google, the picker's and the submit's.
    dbm.sealed.mockResolvedValue(sealedRow({ status: "needs_reconnect", reconnectTaskId: "task-1" }));
    g.calls.length = 0;
    forgetGoogleBusyMemory();
    expect(iso(await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps))).toEqual(HOURS_9_TO_16);
    expect(await bookableSlot(db, cal(), "UTC", NOW, new Date(`${DAY}T10:00:00Z`), deps)).not.toBeNull();
    expect(g.calls).toEqual([]);
    await d.run();
    expect(dbm.addTask).toHaveBeenCalledTimes(1);
  });

  it("a second failure that marks nothing (already marked, or a reconnect landed since the read) opens no To-do", async () => {
    dbm.mark.mockResolvedValue("unchanged");
    const g = fakeGoogle({ refresh: "invalid_grant" });
    const d = deferred();
    await computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: g.fetch, env: ENV, defer: d.defer });
    await d.run();
    expect(dbm.mark.mock.calls).toEqual([[db, CONN, 3]]);
    expect(dbm.addTask).not.toHaveBeenCalled();
    expect(dbm.setTask).not.toHaveBeenCalled();
  });

  it("a To-do the row would not keep (a reconnect landed between the mark and the set) is completed, in this account", async () => {
    dbm.setTask.mockResolvedValue(false);
    const g = fakeGoogle({ refresh: "invalid_grant" });
    const d = deferred();
    await computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: g.fetch, env: ENV, defer: d.defer });
    await d.run();
    expect(dbm.completeReconnect.mock.calls.map((c) => c.slice(1))).toEqual([[ACCOUNT, "task-1"]]);
  });

  it("the To-do reads the account's language", async () => {
    dbm.language.mockResolvedValue("es");
    const g = fakeGoogle({ refresh: "invalid_grant" });
    const d = deferred();
    await computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: g.fetch, env: ENV, defer: d.defer });
    await d.run();
    expect(dbm.addTask.mock.calls[0]![2]).toMatchObject({ title: "Vuelva a conectar su Google Calendar" });
  });

  it("a failing mark is logged, never thrown into the caller", async () => {
    dbm.mark.mockRejectedValue(new Error("markGoogleNeedsReconnect failed: boom"));
    const g = fakeGoogle({ refresh: "invalid_grant" });
    const d = deferred();
    await computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: g.fetch, env: ENV, defer: d.defer });
    await expect(d.run()).resolves.toBeUndefined();
    expect(lines.some((l) => l.includes("markGoogleNeedsReconnect failed: boom"))).toBe(true);
  });
});

describe("the window (D9): the asked day plus one day each side, in every zone", () => {
  it("a block ending 23:50 the day before, with a 240-minute buffer, blocks the early slots (probe: same-day-only window -> FAILS)", async () => {
    const g = fakeGoogle({ busy: [["2027-05-31T22:00:00Z", "2027-05-31T23:50:00Z"]] });
    const c = cal({ buffer_minutes: 240, open_hours: everyDay("00:00", "06:00") });
    const starts = iso(await computeDaySlots(db, c, "UTC", new Date("2027-05-30T00:00:00Z"), DAY, { fetch: g.fetch, env: ENV }));
    expect(starts).toEqual([`${DAY}T03:50:00.000Z`, `${DAY}T04:50:00.000Z`]);
  });

  it("Pacific/Kiritimati (UTC+14): the window reaches the day before the local day, so its late block still blocks", async () => {
    // Local 2027-06-01 starts at 2027-05-31T10:00Z. The block is local 05-31 21:00-23:50.
    const g = fakeGoogle({ busy: [["2027-05-31T07:00:00Z", "2027-05-31T09:50:00Z"]] });
    const c = cal({ buffer_minutes: 240, open_hours: everyDay("00:00", "06:00") });
    const starts = iso(await computeDaySlots(db, c, "Pacific/Kiritimati", new Date("2027-05-30T00:00:00Z"), DAY, { fetch: g.fetch, env: ENV }));
    expect(starts).toEqual(["2027-05-31T13:50:00.000Z", "2027-05-31T14:50:00.000Z"]); // local 03:50, 04:50
  });

  it("covers the local day, minus and plus a 240-minute buffer, at both ends of the offset range", () => {
    const w = googleBusyWindow(DAY)!;
    // Kiritimati +14: local 06-01 runs 05-31T10:00Z .. 06-01T10:00Z. Etc/GMT+12 (UTC-12): 06-01T12:00Z .. 06-02T12:00Z.
    expect(w.timeMin.getTime()).toBeLessThanOrEqual(Date.parse("2027-05-31T10:00:00Z") - 240 * 60_000);
    expect(w.timeMax.getTime()).toBeGreaterThanOrEqual(Date.parse("2027-06-02T12:00:00Z") + 240 * 60_000);
    // ... and is the asked day plus one day each side in those zones, never more than four days wide.
    expect(w.timeMax.getTime() - w.timeMin.getTime()).toBeLessThanOrEqual(4.1 * 24 * 3600_000);
    expect(googleBusyWindow("2027-02-30")).toBeNull();
    expect(googleBusyWindow("not-a-day")).toBeNull();
  });

  it("the window asked of Google is the one for the slot's own day", async () => {
    const g = fakeGoogle({ busy: [] });
    await bookableSlot(db, cal(), "UTC", NOW, new Date(`${DAY}T10:00:00Z`), { fetch: g.fetch, env: ENV });
    const w = googleBusyWindow(DAY)!;
    expect(g.calls.find((c) => c.window)!.window).toEqual({ timeMin: w.timeMin.toISOString(), timeMax: w.timeMax.toISOString() });
  });
});

describe("DST and other zones: a busy block blocks exactly its instants", () => {
  it("fall-back day (America/Chicago, 2027-11-07): a block on the SECOND 01:30 leaves the first 01:30 offered", async () => {
    const c = cal({ slot_duration_minutes: 30, open_hours: everyDay("00:00", "03:00") });
    const now = new Date("2027-11-06T12:00:00Z");
    const day = "2027-11-07";
    const control = iso(await computeDaySlots(db, c, "America/Chicago", now, day, { fetch: fakeGoogle({}).fetch, env: {} }));
    expect(control).toContain("2027-11-07T06:30:00.000Z"); // the first 01:30 (CDT)
    forgetGoogleBusyMemory();
    const second = iso(await computeDaySlots(db, c, "America/Chicago", now, day,
      { fetch: fakeGoogle({ busy: [["2027-11-07T07:30:00Z", "2027-11-07T08:00:00Z"]] }).fetch, env: ENV }));
    expect(second).toEqual(control.filter((s) => s !== "2027-11-07T07:30:00.000Z"));
    expect(second).toContain("2027-11-07T06:30:00.000Z");
    forgetGoogleBusyMemory();
    const first = iso(await computeDaySlots(db, c, "America/Chicago", now, day,
      { fetch: fakeGoogle({ busy: [["2027-11-07T06:30:00Z", "2027-11-07T07:00:00Z"]] }).fetch, env: ENV }));
    expect(first).toEqual(control.filter((s) => s !== "2027-11-07T06:30:00.000Z"));
  });

  it("spring-forward day (America/Chicago, 2027-03-14): a 03:00-04:00 CDT block removes only 03:00", async () => {
    const c = cal({ open_hours: everyDay("00:00", "05:00") });
    const now = new Date("2027-03-13T12:00:00Z");
    const day = "2027-03-14";
    const control = iso(await computeDaySlots(db, c, "America/Chicago", now, day, { fetch: fakeGoogle({}).fetch, env: {} }));
    expect(control).toEqual(["06", "07", "08", "09"].map((h) => `${day}T${h}:00:00.000Z`)); // 00:00, 01:00 CST; 03:00, 04:00 CDT
    const blocked = iso(await computeDaySlots(db, c, "America/Chicago", now, day,
      { fetch: fakeGoogle({ busy: [["2027-03-14T08:00:00Z", "2027-03-14T09:00:00Z"]] }).fetch, env: ENV }));
    expect(blocked).toEqual(control.filter((s) => s !== "2027-03-14T08:00:00.000Z"));
  });

  it("an all-day block from a calendar in another zone (Asia/Tokyo's June 1) blocks exactly its instants in a UTC account", async () => {
    const g = fakeGoogle({ busy: [["2027-05-31T15:00:00Z", "2027-06-01T15:00:00Z"]] });
    expect(iso(await computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: g.fetch, env: ENV })))
      .toEqual([`${DAY}T15:00:00.000Z`, `${DAY}T16:00:00.000Z`]);
  });
});

describe("review I1: a Google failure at submit never refuses what the picker offered (Q1)", () => {
  // Google 10:00-10:30 with 60-minute slots: the day re-anchors at 10:30, so the picker offers 10:30, 11:30, ...
  const busy: Busy[] = [[`${DAY}T10:00:00Z`, `${DAY}T10:30:00Z`]];
  const at = (t: string) => new Date(`${DAY}T${t}:00Z`);

  async function pickerThenGoogleFails(keepMemo: boolean) {
    const deps = { fetch: fakeGoogle({ busy }).fetch, env: ENV };
    const offered = iso(await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps));
    expect(offered).toEqual(["09:00", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30"].map((t) => `${DAY}T${t}:00.000Z`));
    if (!keepMemo) forgetGoogleBusyMemory(); // the picker was served by another instance (a call, another lambda)
    deps.fetch = fakeGoogle({ busy, freebusy: 500 }).fetch;
    return deps;
  }

  it("with this instance's memo: 11:30 is bookable and Google's 10:00 is still refused", async () => {
    const deps = await pickerThenGoogleFails(true);
    expect(await bookableSlot(db, cal(), "UTC", NOW, at("11:30"), deps)).toEqual({ startsAt: at("11:30"), endsAt: at("12:30") });
    expect(await bookableSlot(db, cal(), "UTC", NOW, at("10:00"), deps)).toBeNull();
  });

  it("with no memo: 11:30 is bookable on BIS's own rules, off the base grid (and movable to)", async () => {
    const deps = await pickerThenGoogleFails(false);
    expect(await bookableSlot(db, cal(), "UTC", NOW, at("11:30"), deps)).toEqual({ startsAt: at("11:30"), endsAt: at("12:30") });
    const moving = { id: "own", startsAt: at("15:00"), endsAt: at("16:00") };
    expect(await movableSlot(db, cal(), "UTC", NOW, moving, at("11:30"), deps)).not.toBeNull();
  });

  it("with no memo every BIS rule still holds: a BIS booking and its buffer, the close and a non-minute start are refused", async () => {
    const deps = await pickerThenGoogleFails(false);
    dbm.booked.mockResolvedValue([{ starts_at: `${DAY}T12:40:00.000Z`, ends_at: `${DAY}T13:15:00.000Z` }]);
    const c = cal({ buffer_minutes: 15 });
    expect(await bookableSlot(db, c, "UTC", NOW, at("11:30"), deps)).toBeNull(); // ends 12:30; the buffer reaches 12:45, past the 12:40 booking
    expect(await bookableSlot(db, c, "UTC", NOW, at("13:00"), deps)).toBeNull(); // over the booking
    expect(await bookableSlot(db, c, "UTC", NOW, at("16:30"), deps)).toBeNull(); // past the 17:00 close
    expect(await bookableSlot(db, c, "UTC", NOW, new Date(`${DAY}T10:30:30Z`), deps)).toBeNull();
    expect(await bookableSlot(db, c, "UTC", NOW, at("10:15"), deps)).not.toBeNull(); // ends 11:15, buffer to 11:30, clear of 12:40
    // Re-review minors: each rule alone. Before opening; inside notice; on a closed day.
    expect(await bookableSlot(db, c, "UTC", NOW, at("08:30"), deps)).toBeNull();
    expect(await bookableSlot(db, cal({ buffer_minutes: 15, min_notice_hours: 11 }), "UTC", NOW, at("10:15"), deps)).toBeNull();
    dbm.closed.mockResolvedValue([{
      id: "cd1", account_id: ACCOUNT, starts_on: DAY, ends_on: DAY, reason: "holiday", created_by: "user_1", created_at: "2027-05-20T00:00:00Z",
    }]);
    expect(await bookableSlot(db, c, "UTC", NOW, at("10:15"), deps)).toBeNull();
  });

  it("when Google answers, an off-grid start is still refused: the loosening is for a failure only", async () => {
    expect(await bookableSlot(db, cal(), "UTC", NOW, at("11:30"), { fetch: fakeGoogle({ busy: [] }).fetch, env: ENV })).toBeNull();
  });

  it("re-review I-3: off the grid, a start must sit on the 5-minute wall clock: 09:07 refused, 09:05 kept", async () => {
    const deps = await pickerThenGoogleFails(false);
    expect(await bookableSlot(db, cal(), "UTC", NOW, at("09:07"), deps)).toBeNull();
    expect(await bookableSlot(db, cal(), "UTC", NOW, at("09:05"), deps)).toEqual({ startsAt: at("09:05"), endsAt: at("10:05") });
    expect(await bookableSlot(db, cal(), "UTC", NOW, at("11:30"), deps)).not.toBeNull();
  });
});

describe("re-review I-1: the grid is loosened only when Google itself was asked and failed", () => {
  const at = (t: string) => new Date(`${DAY}T${t}:00Z`);
  const offGrid = ["09:05", "09:07"] as const;
  const refusedBoth = async (deps: Parameters<typeof bookableSlot>[5]) => {
    for (const t of offGrid) expect(await bookableSlot(db, cal(), "UTC", NOW, at(t), deps), t).toBeNull();
    expect(await bookableSlot(db, cal(), "UTC", NOW, at("10:00"), deps)).not.toBeNull(); // the control: on the grid
  };

  it("the connection read throws: off-grid starts refused", async () => {
    dbm.sealed.mockRejectedValue(new Error("readGoogleConnectionSealed failed: boom"));
    await refusedBoth({ fetch: fakeGoogle({ freebusy: 500 }).fetch, env: ENV });
  });

  it("the budget runs out while the connection is still being read (1.8 s, no row): refused", async () => {
    vi.useFakeTimers();
    dbm.sealed.mockImplementation(() => new Promise((r) => setTimeout(() => r(null), 1_800)));
    const deps = { fetch: fakeGoogle({ freebusy: 500 }).fetch, env: ENV };
    for (const t of [...offGrid, "10:00"]) {
      const pending = bookableSlot(db, cal(), "UTC", NOW, at(t), deps);
      await vi.advanceTimersByTimeAsync(1_800);
      const r = await pending;
      if (t === "10:00") expect(r, t).not.toBeNull(); else expect(r, t).toBeNull();
    }
  });

  it("a token no key opens: refused", async () => {
    dbm.sealed.mockResolvedValue(sealedRow({ key: Buffer.alloc(32, 4).toString("base64url") }));
    await refusedBoth({ fetch: fakeGoogle({ freebusy: 500 }).fetch, env: ENV });
  });

  it("off: no connection, a row needing reconnecting, the feature dormant: refused", async () => {
    dbm.sealed.mockResolvedValue(null);
    await refusedBoth({ fetch: fakeGoogle({ freebusy: 500 }).fetch, env: ENV });
    dbm.sealed.mockResolvedValue(sealedRow({ status: "needs_reconnect", reconnectTaskId: "task-0" }));
    await refusedBoth({ fetch: fakeGoogle({ freebusy: 500 }).fetch, env: ENV });
    await refusedBoth({ fetch: fakeGoogle({ freebusy: 500 }).fetch, env: {} });
  });

  it("Google asked and failing (a 500, a refresh 5xx): 09:05 kept", async () => {
    expect(await bookableSlot(db, cal(), "UTC", NOW, at("09:05"), { fetch: fakeGoogle({ freebusy: 500 }).fetch, env: ENV })).not.toBeNull();
  });
});

describe("re-review I-2: picker and submit use the same past answer during an outage", () => {
  it("Google OK (busy 10:00-10:30), then a 500 after 61 s: the picker does not offer 10:00 and the submit accepts every offered start", async () => {
    let clock = 5_000_000;
    const busy: Busy[] = [[`${DAY}T10:00:00Z`, `${DAY}T10:30:00Z`]];
    const deps = { fetch: fakeGoogle({ busy }).fetch, env: ENV, clock: () => clock };
    await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps);
    clock += 61_000;
    deps.fetch = fakeGoogle({ busy, freebusy: 500 }).fetch;
    const offered = await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps);
    expect(iso(offered)).not.toContain(`${DAY}T10:00:00.000Z`);
    expect(iso(offered)).toContain(`${DAY}T10:30:00.000Z`);
    for (const s of offered) expect(await bookableSlot(db, cal(), "UTC", NOW, s.startsAt, deps), s.startsAt.toISOString()).toEqual(s);
  });
});

describe("re-review minors: the past answer is this connection's version and this day only", () => {
  const at = (d: string, t: string) => new Date(`${d}T${t}:00Z`);
  it("a reconnect (a new version) does not inherit the old version's answer (mutation: key without version -> FAILS)", async () => {
    const deps = { fetch: fakeGoogle({ busy: [[`${DAY}T10:00:00Z`, `${DAY}T10:30:00Z`]] }).fetch, env: ENV };
    await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps);
    dbm.sealed.mockResolvedValue(sealedRow({ version: 4 }));
    deps.fetch = fakeGoogle({ freebusy: 500 }).fetch;
    expect(await bookableSlot(db, cal(), "UTC", NOW, at(DAY, "10:00"), deps)).not.toBeNull();
  });

  it("another day's answer is not this day's, though its window reaches into it (mutation: key without day -> FAILS)", async () => {
    const NEXT = "2027-06-02";
    const deps = { fetch: fakeGoogle({ busy: [[`${NEXT}T10:00:00Z`, `${NEXT}T10:30:00Z`]] }).fetch, env: ENV };
    await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps); // DAY's window holds NEXT's 10:00 block
    deps.fetch = fakeGoogle({ freebusy: 500 }).fetch;
    expect(await bookableSlot(db, cal(), "UTC", NOW, at(NEXT, "10:00"), deps)).not.toBeNull();
  });
});

describe("review I2: each account reads with its own credentials, memo and token", () => {
  it("B's refresh and freeBusy use B's credentials and return B's busy time; B never gets A's memo or token (probes: one token key, memo key without the connection -> FAIL)", async () => {
    const B = "b2b2b2b2-0000-4000-8000-000000000002";
    const CONN_B = "22222222-2222-4222-8222-222222222222";
    const REFRESH_B = "1//0gREFRESH-B-token_zyxwvutsrqpo";
    const rows: Record<string, unknown> = {
      [ACCOUNT]: sealedRow(), [B]: sealedRow({ accountId: B, id: CONN_B, refresh: REFRESH_B }), // both at version 3
    };
    dbm.sealed.mockImplementation(async (_db: unknown, accountId: string) => rows[accountId] ?? null);
    const per: Record<string, { access: string; busy: Busy }> = {
      [REFRESH]: { access: "ya29.AAA_account_a_token", busy: [`${DAY}T10:00:00Z`, `${DAY}T11:00:00Z`] },
      [REFRESH_B]: { access: "ya29.BBB_account_b_token", busy: [`${DAY}T13:00:00Z`, `${DAY}T14:00:00Z`] },
    };
    const refreshed: string[] = [];
    const bearers: string[] = [];
    const fetchBoth = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/token")) {
        const rt = new URLSearchParams(String(init?.body)).get("refresh_token")!;
        refreshed.push(rt);
        return Response.json({ access_token: per[rt]!.access, expires_in: 3599 });
      }
      const bearer = String((init?.headers as Record<string, string>).authorization).replace("Bearer ", "");
      bearers.push(bearer);
      const owner = Object.values(per).find((p) => p.access === bearer)!;
      return Response.json({ calendars: { primary: { busy: [{ start: owner.busy[0], end: owner.busy[1] }] } } });
    }) as unknown as typeof fetch;
    const deps = { fetch: fetchBoth, env: ENV };

    const a = iso(await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps));
    const b = iso(await computeDaySlots(db, cal({ id: "cal2", account_id: B }), "UTC", NOW, DAY, deps));
    expect(a).toEqual(HOURS_9_TO_16.filter((s) => !s.includes("T10:")));
    expect(b).toEqual(HOURS_9_TO_16.filter((s) => !s.includes("T13:")));
    expect(refreshed).toEqual([REFRESH, REFRESH_B]);
    expect(bearers).toEqual(["ya29.AAA_account_a_token", "ya29.BBB_account_b_token"]);
    // A again, inside the minute: A's own memo, no Google call.
    expect(iso(await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps))).toEqual(a);
    expect(bearers).toHaveLength(2);
  });
});

describe("review I3: how a failure is classified", () => {
  it("a 401 on a token refreshed for this read is outcome=disconnected, and marks after the answer", async () => {
    const d = deferred();
    await computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: fakeGoogle({ freebusy: 401 }).fetch, env: ENV, defer: d.defer });
    expect(lines).toEqual([expect.stringMatching(/ outcome=disconnected reason=http_401 google_busy_ms=\d+$/)]);
    await d.run();
    expect(dbm.mark.mock.calls).toEqual([[db, CONN, 3]]);
  });

  it("a 401 on a cached token is unchecked, marks nothing, drops the token and refreshes on the next read", async () => {
    const d = deferred();
    const deps = { fetch: fakeGoogle({ busy: [] }).fetch, env: ENV, defer: d.defer };
    await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps); // caches the access token
    lines.length = 0;
    const second = fakeGoogle({ freebusy: 401 });
    deps.fetch = second.fetch;
    await bookableSlot(db, cal(), "UTC", NOW, new Date(`${DAY}T10:00:00Z`), deps); // fresh read, cached token
    expect(second.urls()).toEqual(["https://www.googleapis.com/calendar/v3/freeBusy"]);
    expect(lines).toEqual([expect.stringMatching(/ outcome=unchecked reason=http_401 google_busy_ms=\d+$/)]);
    await d.run();
    expect(dbm.mark).not.toHaveBeenCalled();
    const third = fakeGoogle({ busy: [] });
    deps.fetch = third.fetch;
    await bookableSlot(db, cal(), "UTC", NOW, new Date(`${DAY}T10:00:00Z`), deps);
    expect(third.urls()).toEqual(["https://oauth2.googleapis.com/token", "https://www.googleapis.com/calendar/v3/freeBusy"]);
  });

  it("a row whose token no key opens is reason=token_unopened, asks Google nothing and marks nothing", async () => {
    dbm.sealed.mockResolvedValue(sealedRow({ key: Buffer.alloc(32, 4).toString("base64url") }));
    const g = fakeGoogle({ busy: [] });
    const d = deferred();
    expect(iso(await computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: g.fetch, env: ENV, defer: d.defer }))).toEqual(HOURS_9_TO_16);
    expect(lines).toEqual([expect.stringMatching(/ outcome=unchecked reason=token_unopened google_busy_ms=\d+$/)]);
    expect(g.calls).toEqual([]);
    await d.run();
    expect(dbm.mark).not.toHaveBeenCalled();
  });
});

describe("review minors: partial failures and the deferred work", () => {
  it("a marked row with no To-do (its To-do never opened) gets it on a later read, once per instance, without marking again", async () => {
    dbm.sealed.mockResolvedValue(sealedRow({ status: "needs_reconnect", reconnectTaskId: null }));
    const g = fakeGoogle({ busy: [] });
    const d = deferred();
    const deps = { fetch: g.fetch, env: ENV, defer: d.defer };
    expect(iso(await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps))).toEqual(HOURS_9_TO_16);
    await computeDaySlots(db, cal(), "UTC", NOW, DAY, deps);
    await d.run();
    expect(g.calls).toEqual([]);
    expect(dbm.mark).not.toHaveBeenCalled();
    expect(dbm.addTask).toHaveBeenCalledTimes(1);
    expect(dbm.setTask.mock.calls).toEqual([[db, CONN, 3, "task-1"]]);
  });

  it("a marked row that holds its To-do opens none", async () => {
    dbm.sealed.mockResolvedValue(sealedRow({ status: "needs_reconnect", reconnectTaskId: "task-0" }));
    const d = deferred();
    await computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: fakeGoogle({}).fetch, env: ENV, defer: d.defer });
    await d.run();
    expect(dbm.addTask).not.toHaveBeenCalled();
  });

  it("a set that throws after the To-do opened completes that To-do in this account, and is logged", async () => {
    dbm.setTask.mockRejectedValue(new Error("setGoogleReconnectTask failed: boom"));
    const d = deferred();
    await computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: fakeGoogle({ refresh: "invalid_grant" }).fetch, env: ENV, defer: d.defer });
    await d.run();
    expect(dbm.completeReconnect.mock.calls).toEqual([[db, ACCOUNT, "task-1"]]);
    expect(lines.some((l) => l.includes("setGoogleReconnectTask failed: boom"))).toBe(true);
  });

  it("a defer that throws is logged; the read still answers", async () => {
    const throwing = () => { throw new Error("after() outside a request"); };
    const slots = await computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: fakeGoogle({ busy: [] }).fetch, env: ENV, defer: throwing });
    expect(iso(slots)).toEqual(HOURS_9_TO_16);
    expect(lines.some((l) => l.includes("after() outside a request"))).toBe(true);
  });

  it("the voice path (no defer): a stamp that never settles does not hold the answer", async () => {
    dbm.stamp.mockImplementation(() => new Promise(() => {}));
    const slots = await computeDaySlots(db, cal(), "UTC", NOW, DAY, { fetch: fakeGoogle({ busy: [] }).fetch, env: ENV });
    expect(iso(slots)).toEqual(HOURS_9_TO_16);
    expect(dbm.stamp).toHaveBeenCalledWith(db, CONN, 3);
  });
});
