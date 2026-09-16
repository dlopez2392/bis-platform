import type { SmsProvider, SendSmsInput, SendSmsResult } from "./types";

class FakeSmsProvider implements SmsProvider {
  readonly isFake = true;

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    // Deliberately does not deliver. Logged so a developer can see that a
    // send was attempted and to whom it *would* have gone.
    //
    // "The code is not legible" (alert-phone-verification.ts's own comment
    // on hashAlertCode) is true only in PRODUCTION, where this fake never
    // runs. Everywhere else this IS the send path, and its log is exactly
    // as readable as a dashboard row — so a bare six-digit run (an alert
    // verification code, and anything else shaped like one) is redacted
    // before it reaches the console, the same way the database never stores
    // the code as written.
    const redactedBody = input.body.slice(0, 60).replace(/\b\d{6}\b/g, "••••••");
    console.info(`[sms:fake] suppressed send to ${input.to} — ${redactedBody}`);
    return { providerMessageId: `fake_${Math.random().toString(36).slice(2, 12)}` };
  }
}

export function fakeSmsProvider(): SmsProvider {
  return new FakeSmsProvider();
}
