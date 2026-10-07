import { SmsProviderError, type SmsProvider, type SendSmsInput, type SendSmsResult } from "./types";

const TELNYX_MESSAGES_URL = "https://api.telnyx.com/v2/messages";

/** Outbound sends must not hold a webhook open. finishCall runs on Telnyx's
 *  own callback after the caller hung up; a hanging provider there would keep
 *  that request alive for the platform's whole function timeout. */
const SEND_TIMEOUT_MS = 10_000;

class TelnyxSmsProvider implements SmsProvider {
  readonly isFake = false;
  constructor(
    private readonly apiKey: string,
    readonly redirectTo?: string,
  ) {}

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    const to = this.redirectTo ?? input.to;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch(TELNYX_MESSAGES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: input.from, to, text: input.body }),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new SmsProviderError(`telnyx send failed (${res.status}): ${text}`, res.status, errorCodes(text));
      const parsed = JSON.parse(text) as { data?: { id?: string } };
      const id = parsed.data?.id;
      if (!id) throw new Error(`telnyx send returned no message id: ${text}`);
      return { providerMessageId: id };
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

export function telnyxSmsProvider(apiKey: string, redirectTo?: string): SmsProvider {
  return new TelnyxSmsProvider(apiKey, redirectTo);
}
