/**
 * What the alert pass decides, as a pure function of the heartbeat rows and
 * the tick's `now` (operational-floor spec §2). No I/O here, so every rule
 * below is a unit test rather than a database fixture.
 *
 * THE RULES, and why each is shaped the way it is:
 *  - A cron pass is failing at TWO consecutive failures, never one. One bad
 *    tick is usually a provider blip that the next tick retries; two is half
 *    an hour of something not happening.
 *  - Any other key (a webhook, Sofía's line) is failing while its last error
 *    is newer than its last success. One failed webhook is worth knowing:
 *    nothing retries a Telnyx call that was dropped.
 *  - SILENCE IS NOT A FAILURE. A key that has simply not been heard from is
 *    never alerted on here: a quiet afternoon with no calls is normal for a
 *    small client, and an alert that cries wolf gets filtered. The one silence
 *    that matters, the cron itself stopping, is watched from OUTSIDE by the
 *    hourly GitHub workflow against /api/ops/health, because a pass cannot
 *    report that the passes stopped running.
 *  - `cron.tick` is the health route's, not this pass's, for the same reason.
 *  - ONE EMAIL PER INCIDENT. `alertedAt` marks a key already reported; a key
 *    still failing is reported again only after RE_ALERT_MS, and a reported
 *    key that is healthy again produces one "recovered" line.
 */

export type Heartbeat = {
  key: string;
  lastOkAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  alertedAt: Date | null;
};

export type WatchVerdict = {
  /** Failing keys to report this tick: new, or due a reminder. */
  alert: Heartbeat[];
  /** Keys that were reported and are healthy again. */
  recovered: Heartbeat[];
};

export const CRON_TICK_KEY = "cron.tick";
export const RE_ALERT_MS = 6 * 60 * 60_000;
export const CRON_PASS_FAILURES_TO_ALERT = 2;

export function isFailing(h: Heartbeat): boolean {
  if (h.key === CRON_TICK_KEY) return false;
  if (h.key.startsWith("cron.pass.")) return h.consecutiveFailures >= CRON_PASS_FAILURES_TO_ALERT;
  if (!h.lastErrorAt) return false;
  return !h.lastOkAt || h.lastErrorAt.getTime() > h.lastOkAt.getTime();
}

export function evaluate(rows: readonly Heartbeat[], now: Date): WatchVerdict {
  const alert: Heartbeat[] = [];
  const recovered: Heartbeat[] = [];
  for (const h of rows) {
    if (h.key === CRON_TICK_KEY) continue;
    if (isFailing(h)) {
      if (!h.alertedAt || now.getTime() - h.alertedAt.getTime() >= RE_ALERT_MS) alert.push(h);
    } else if (h.alertedAt) {
      recovered.push(h);
    }
  }
  const byKey = (a: Heartbeat, b: Heartbeat) => a.key.localeCompare(b.key);
  return { alert: alert.sort(byKey), recovered: recovered.sort(byKey) };
}

/** Plain-language names for the keys BIS staff will read in an alert. */
export function describeKey(key: string): string {
  if (key.startsWith("cron.pass.")) return `the scheduled job "${key.slice("cron.pass.".length)}"`;
  switch (key) {
    case "voice.texml": return "incoming calls (Telnyx call routing)";
    case "voice.incoming": return "Sofía's call webhook (OpenAI)";
    case "voice.sofia": return "Sofía answering calls (the AI line was unreachable)";
    case "sms.inbound": return "incoming texts (Telnyx)";
    case "email.resend_webhook": return "email delivery reports (Resend)";
    case "stripe.webhook": return "billing events (Stripe)";
    default: return key;
  }
}

const iso = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "never");

/** The email, in plain text: what is wrong, since when, and what was last said. */
export function composeOpsEmail(verdict: WatchVerdict): { subject: string; body: string } | null {
  const { alert, recovered } = verdict;
  if (alert.length === 0 && recovered.length === 0) return null;

  const subject = alert.length > 0
    ? `BIS platform: ${alert.length} problem${alert.length === 1 ? "" : "s"} need${alert.length === 1 ? "s" : ""} a look`
    : `BIS platform: ${recovered.length === 1 ? "back to normal" : `${recovered.length} things back to normal`}`;

  const lines: string[] = [];
  if (alert.length > 0) {
    lines.push("Something on the platform is failing:", "");
    for (const h of alert) {
      lines.push(`- ${describeKey(h.key)}`);
      lines.push(`  Failing since: ${iso(h.lastErrorAt)} (${h.consecutiveFailures} in a row). Last worked: ${iso(h.lastOkAt)}.`);
      if (h.lastError) lines.push(`  Last error: ${h.lastError.split("\n")[0]}`);
    }
    lines.push("", "You will hear again in six hours if it is still failing, and once when it recovers.");
  }
  if (recovered.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Working again:", "");
    for (const h of recovered) lines.push(`- ${describeKey(h.key)} (last worked ${iso(h.lastOkAt)})`);
  }
  return { subject, body: lines.join("\n") };
}
