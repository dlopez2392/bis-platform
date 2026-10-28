import { SmsProviderError, type SmsProvider, type SendSmsInput, type SendSmsResult } from "./types";
import { rateLimitWaitMs, realSleep, SEND_TIMEOUT_MS, type Sleep } from "@/lib/http/retry-after";

const TELNYX_MESSAGES_URL = "https://api.telnyx.com/v2/messages";

/** One attempt's answer, read in full inside that attempt's own timer. */
type Attempt = { status: number; ok: boolean; text: string; retryAfter: string | null };

class TelnyxSmsProvider implements SmsProvider {
  readonly isFake = false;
  constructor(
    private readonly apiKey: string,
    readonly redirectTo: string | undefined,
    private readonly sleep: Sleep,
  ) {}

  /**
   * F-196 Q4: one send is at most attempt + wait + attempt (`lib/http/retry-after.ts`).
   * A 429 asking for at most 3 s is waited out and the POST made once more;
   * any other refusal, or a longer ask, throws now and the next tick retries.
   */
  async send(input: SendSmsInput): Promise<SendSmsResult> {
    const to = this.redirectTo ?? input.to;
    const body = JSON.stringify({ from: input.from, to, text: input.body });
    let res = await this.attempt(body);
    if (res.status === 429) {
      const ms = rateLimitWaitMs(res.retryAfter, Date.now());
      if (ms !== null) {
        await this.sleep(ms);
        res = await this.attempt(body);
      }
    }
    const { text } = res;
    if (!res.ok) throw new SmsProviderError(`telnyx send failed (${res.status}): ${text}`, res.status, errorCodes(text));
    const parsed = JSON.parse(text) as { data?: { id?: string } };
    const id = parsed.data?.id;
    if (!id) throw new Error(`telnyx send returned no message id: ${text}`);
    return { providerMessageId: id };
  }

  /**
   * One POST under its OWN AbortController and its own SEND_TIMEOUT_MS timer,
   * so the retry gets a fresh 10 s rather than what is left of the first.
   * Outbound sends must not hold a webhook open: finishCall runs on Telnyx's
   * own callback after the caller hung up, and a hanging provider there would
   * keep that request alive for the platform's whole function timeout.
   */
  private async attempt(body: string): Promise<Attempt> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch(TELNYX_MESSAGES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: controller.signal,
      });
      const text = await res.text();
      return { status: res.status, ok: res.ok, text, retryAfter: res.headers.get("retry-after") };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Telnyx error codes from a refused send's body, `{"errors":[{"code":"40300",…}]}`
 * (developers.telnyx.com/docs/messaging/messages/advanced-opt-in-out, read
 * 2026-09-26). Never throws: a body that is not that shape has no codes.
 */
export function errorCodes(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as { errors?: { code?: unknown }[] };
    if (!Array.isArray(parsed.errors)) return [];
    return parsed.errors.map((e) => e?.code).filter((c) => typeof c === "string" || typeof c === "number").map(String);
  } catch {
    return [];
  }
}

export function telnyxSmsProvider(apiKey: string, redirectTo?: string, sleep: Sleep = realSleep): SmsProvider {
  return new TelnyxSmsProvider(apiKey, redirectTo, sleep);
}
