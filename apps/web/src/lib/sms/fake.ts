import type { SmsProvider, SendSmsInput, SendSmsResult } from "./types";

class FakeSmsProvider implements SmsProvider {
  readonly isFake = true;

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    // Deliberately does not deliver. Logged so a developer can see that a
    // send was attempted and to whom it *would* have gone.
    console.info(`[sms:fake] suppressed send to ${input.to} — ${input.body.slice(0, 60)}`);
    return { providerMessageId: `fake_${Math.random().toString(36).slice(2, 12)}` };
  }
}

export function fakeSmsProvider(): SmsProvider {
  return new FakeSmsProvider();
}
