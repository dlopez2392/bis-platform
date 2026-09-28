import type { SupabaseClient } from "@bis/db";
import type { EmailProvider } from "@/lib/email/types";
import type { SmsSender } from "@/lib/consent/gate";

/**
 * What every pass is handed for one cron tick.
 *
 * DELIBERATELY ABSENT: `accountName`. `accounts.name` is the agency's internal
 * label for a company ("Rio Roofing — trial") and it has reached customers
 * three times (the P5 copy, the email From line, the text-back body). A
 * recipe author cannot leak what they cannot reach: due-rows carry
 * `brandName` (resolved in the data layer) and this context carries no name
 * at all. harness.test.ts pins the absence with a `@ts-expect-error`.
 */
export type PassContext = {
  db: SupabaseClient;
  /** The tick instant. Passes read this, never `new Date()`, so one tick has
   *  ONE "now" — the reminder query and the follow-up gate cannot disagree
   *  about what time it is. */
  now: Date;
  /** APP_ORIGIN when set, else the request's own origin — for links in
   *  customer mail. See origin.ts for why APP_ORIGIN must win. */
  origin: string;
  /** Constructed once per tick by the harness. In production this THROWS at
   *  construction when RESEND_API_KEY/EMAIL_FROM are unset — loudly, before
   *  any query, which is the designed failure. */
  email: EmailProvider;
  /** THE SEND GATE, bound to this tick's client (consent chain spec §4.1
   *  item 4: "the harness's ctx.sms() becomes the gate's sendSms"). Every
   *  automation text goes through it, via sendAutomationSms. The provider is
   *  constructed inside the gate only once a send is cleared, so a tick with
   *  TELNYX_API_KEY unset in production fails only the sends it decides to
   *  make, never the tick. There is no quiet-hours setting any more: the
   *  hours are fixed (lib/consent/hours.ts). */
  sms: SmsSender;
};

/** Per-pass counters, reported verbatim in the cron's JSON under the pass key. */
export type PassCounters = Record<string, number>;

/**
 * A pass is a HARNESS ENTRY, not an implementation of a shared algorithm.
 * The two live passes are genuinely different (reminders have no morning
 * gate and count a missing email as `failed`; follow-ups have the gate and
 * count it `skippedNoEmail`), so there is no listDue/send/stamp interface —
 * each pass owns its own query, gate, send and stamp. What the registry
 * buys is error isolation, uniform counter reporting, and one place to add
 * a recipe.
 */
export type Pass = {
  readonly key: string;
  run(ctx: PassContext): Promise<PassCounters>;
};
