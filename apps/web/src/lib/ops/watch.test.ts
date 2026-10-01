import { describe, it, expect } from "vitest";
import { evaluate, isFailing, composeOpsEmail, RE_ALERT_MS, type Heartbeat } from "./watch";

const NOW = new Date("2026-10-01T15:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

function hb(over: Partial<Heartbeat> & { key: string }): Heartbeat {
  return { lastOkAt: null, lastErrorAt: null, lastError: null, consecutiveFailures: 0, alertedAt: null, ...over };
}

describe("isFailing — the operational-floor spec §2 rules", () => {
  it("a cron pass fails at two in a row, not one (mutation: >= 1 → the one-failure case FAILS)", () => {
    expect(isFailing(hb({ key: "cron.pass.reminders", consecutiveFailures: 1, lastErrorAt: ago(1) }))).toBe(false);
    expect(isFailing(hb({ key: "cron.pass.reminders", consecutiveFailures: 2, lastErrorAt: ago(1) }))).toBe(true);
  });

  it("a webhook key fails while its last error is newer than its last success", () => {
    expect(isFailing(hb({ key: "voice.texml", lastOkAt: ago(10), lastErrorAt: ago(5) }))).toBe(true);
    expect(isFailing(hb({ key: "voice.texml", lastOkAt: ago(1), lastErrorAt: ago(5) }))).toBe(false);
    expect(isFailing(hb({ key: "voice.texml", lastErrorAt: ago(5) }))).toBe(true);
  });

  it("silence is not a failure: a key never heard from, or quiet for days, is healthy (mutation: alert on a stale last_ok_at → FAILS)", () => {
    expect(isFailing(hb({ key: "voice.texml" }))).toBe(false);
    expect(isFailing(hb({ key: "voice.texml", lastOkAt: ago(60 * 24 * 5) }))).toBe(false);
  });

  it("cron.tick is never this pass's to judge, whatever it holds (the health route watches it from outside)", () => {
    expect(isFailing(hb({ key: "cron.tick", consecutiveFailures: 9, lastErrorAt: ago(1) }))).toBe(false);
  });
});

describe("evaluate — one email per incident", () => {
  it("a newly failing key is alerted; the same key already alerted inside six hours is not (mutation: drop the alertedAt check → FAILS)", () => {
    const fresh = hb({ key: "cron.pass.followups", consecutiveFailures: 2, lastErrorAt: ago(1) });
    const told = hb({ key: "cron.pass.reminders", consecutiveFailures: 5, lastErrorAt: ago(1), alertedAt: ago(30) });
    expect(evaluate([fresh, told], NOW).alert.map((h) => h.key)).toEqual(["cron.pass.followups"]);
  });

  it("a key still failing six hours after its alert is reported again", () => {
    const told = hb({ key: "cron.pass.reminders", consecutiveFailures: 30, lastErrorAt: ago(1), alertedAt: new Date(NOW.getTime() - RE_ALERT_MS) });
    expect(evaluate([told], NOW).alert).toHaveLength(1);
  });

  it("a reported key that works again is reported recovered exactly once (its alertedAt is what makes it news)", () => {
    const back = hb({ key: "voice.texml", lastErrorAt: ago(20), lastOkAt: ago(2), alertedAt: ago(19) });
    const neverTold = hb({ key: "sms.inbound", lastOkAt: ago(2) });
    const v = evaluate([back, neverTold], NOW);
    expect(v.recovered.map((h) => h.key)).toEqual(["voice.texml"]);
    expect(v.alert).toEqual([]);
  });

  it("all quiet produces no email at all", () => {
    expect(composeOpsEmail(evaluate([hb({ key: "voice.texml", lastOkAt: ago(3) })], NOW))).toBeNull();
  });
});

describe("composeOpsEmail — what BIS staff read", () => {
  it("names the failing thing in plain words, when it started, and the error's first line only", () => {
    const mail = composeOpsEmail({
      alert: [hb({ key: "cron.pass.reminders", consecutiveFailures: 3, lastErrorAt: ago(40), lastOkAt: ago(90), lastError: "db exploded\nstack line" })],
      recovered: [],
    })!;
    expect(mail.subject).toBe("BIS platform: 1 problem needs a look");
    expect(mail.body).toContain('the scheduled job "reminders"');
    expect(mail.body).toContain("3 in a row");
    expect(mail.body).toContain("Last error: db exploded");
    expect(mail.body).not.toContain("stack line");
  });

  it("a recovery-only email says so in its subject", () => {
    const mail = composeOpsEmail({ alert: [], recovered: [hb({ key: "voice.texml", lastOkAt: ago(1) })] })!;
    expect(mail.subject).toBe("BIS platform: back to normal");
    expect(mail.body).toContain("Working again");
  });
});

describe("evaluate — a retired pass is not an incident (PASS_STALE_MS)", () => {
  it("a cron.pass row untouched for over an hour is neither alerted nor reported recovered (mutation: drop the stale skip → FAILS)", () => {
    const retired = hb({ key: "cron.pass.oldRecipe", consecutiveFailures: 40, lastErrorAt: ago(61), alertedAt: ago(400) });
    const retiredQuiet = hb({ key: "cron.pass.goneToo", lastOkAt: ago(90), alertedAt: ago(120) });
    expect(evaluate([retired, retiredQuiet], NOW)).toEqual({ alert: [], recovered: [] });
  });

  it("a live pass failing within the hour is still alerted", () => {
    expect(evaluate([hb({ key: "cron.pass.reminders", consecutiveFailures: 2, lastErrorAt: ago(14) })], NOW).alert).toHaveLength(1);
  });
});
