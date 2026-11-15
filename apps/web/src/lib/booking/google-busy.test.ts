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
  stamp: vi.fn(), addTask: vi.fn(), completeTask: vi.fn(), language: vi.fn(),
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
  completeTask: (...a: unknown[]) => dbm.completeTask(...a),
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

function sealedRow(over: { version?: number; status?: "connected" | "needs_reconnect" } = {}) {
  const version = over.version ?? 3;
  const { sealed, keyVersion } = sealGoogleToken(REFRESH, { accountId: ACCOUNT, id: CONN, version }, googleTokenKey(KEY)!);
  return {
    id: CONN, account_id: ACCOUNT, version, status: over.status ?? "connected", google_email: "owner@example.com",
    refresh_token_sealed: sealed, key_version: keyVersion,
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
  dbm.completeTask.mockResolvedValue(undefined);
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
    ["a 401 on a fresh token", { freebusy: 401 }],
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
    expect(dbm.completeTask).not.toHaveBeenCalled();

    // The row now says so: every later read skips Google, the picker's and the submit's.
    dbm.sealed.mockResolvedValue(sealedRow({ status: "needs_reconnect" }));
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
    expect(dbm.completeTask.mock.calls.map((c) => c.slice(1, 3))).toEqual([[ACCOUNT, "task-1"]]);
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
