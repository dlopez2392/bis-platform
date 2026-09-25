import { recordUsage, type SupabaseClient, type UsageInput } from "@bis/db";
import type { SmsProvider } from "@/lib/sms/types";

/**
 * Client billing, the recording half (spec 2026-09-24, section 3 flow 3).
 * Every billable fact writes one usage_events row where it already happens:
 * a call Sofía talked to ends (finish-call.ts), a text reaches a customer
 * (send-sms.ts, textback.ts, the composer's sendSmsAction), Sofía's first
 * reply in a website chat succeeds (the concierge turn route). The cron's usage report
 * (automations/passes/usage-report.ts) sends the rows to Stripe.
 *
 * Recording NEVER checks whether the account is billed: the ledger fills for
 * every account (spec section 4, rollout (2)); only the report looks at
 * account_billing.
 */

/**
 * Minutes billed for a call Sofía talked to: the call's stored duration
 * rounded UP to whole minutes, never fewer than one. Fed the SAME
 * `durationSecs` finishCall writes to the calls row, so the row and the bill
 * agree to the minute (125 s is 3 minutes on both).
 */
export function voiceMinutes(durationSecs: number): number {
  return Math.max(1, Math.ceil(durationSecs / 60));
}

/**
 * Did this send put the text in front of the CUSTOMER? Only then does it
 * bill. The fake provider delivers nothing, and a real provider forced
 * outside production sends every text to a developer's phone
 * (lib/sms/index.ts). Production always holds the real, unredirected
 * provider, so this changes nothing there; it keeps a preview, which writes
 * production's database, from leaving usage rows for texts no customer
 * received. Strict `=== false`: a provider that does not say it is real is
 * not billed.
 */
export function smsBillable(provider: Pick<SmsProvider, "isFake" | "redirectTo">): boolean {
  return provider.isFake === false && provider.redirectTo === undefined;
}

/**
 * A usage write must never hold its caller's send path open: supabase-js has
 * no default timeout on a query (`lib/sms/telnyx.ts:5-8` bounds the same
 * finishCall path's outbound HTTP call for the identical reason — a hanging
 * provider there would keep a webhook alive for the platform's whole
 * function timeout). 5 s, not that call's 10 s: this is one small insert,
 * not a carrier round trip.
 */
const USAGE_WRITE_TIMEOUT_MS = 5_000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`usage write timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `String(e)` throws on a rejection reason with no prototype
 * (`Object.create(null)`): there is no `toString`/`valueOf` to fall back to,
 * and coercing it would turn a LOGGING call into the very escape
 * `recordUsageSafely` exists to prevent. Falls back to a fixed string rather
 * than risk a second throw describing the first.
 */
function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return "unprintable error";
  }
}

/**
 * The ONLY way a send path records usage. Best effort, and it NEVER throws:
 * by the time it runs the text is sent, the call is over or the chat has
 * started, and a ledger problem must not change what the caller of the send
 * path sees, nor skip the steps after it. A failure is logged with what was
 * lost; PR-4's nightly reconciliation is where a missing row gets noticed
 * against Stripe.
 *
 * `db` may be a getter, so a caller on the RLS surface (the composer) builds
 * the service client INSIDE this try: `serviceDb()` throws when its key is
 * missing, and that throw must not escape either. `input` may likewise be a
 * thunk, for a caller whose fields are read off a value that could itself be
 * null or throw while being read (e.g. a row looked up moments earlier) — it
 * is built INSIDE this same try, not by the caller before this function is
 * ever entered, for the same reason. The write itself races
 * `USAGE_WRITE_TIMEOUT_MS`, so a stalled `usage_events` insert is abandoned
 * and logged rather than left open forever.
 */
export async function recordUsageSafely(
  db: SupabaseClient | (() => SupabaseClient),
  input: UsageInput | (() => UsageInput),
  label: string,
): Promise<void> {
  let built: UsageInput | undefined;
  try {
    built = typeof input === "function" ? input() : input;
    const client = typeof db === "function" ? db() : db;
    await withTimeout(recordUsage(client, built), USAGE_WRITE_TIMEOUT_MS);
  } catch (e) {
    const detail = built
      ? `${built.meter} ${built.sourceRef}, quantity ${built.quantity}`
      : "input not built";
    console.error(`${label}: usage not recorded (${detail}): ${describeError(e)}`);
  }
}
