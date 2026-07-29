import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";

class FakeEmailProvider implements EmailProvider {
  readonly isFake = true;

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    // Deliberately does not deliver. Logged so a developer can see that a
    // send was attempted and to whom it *would* have gone.
    console.info(
      `[email:fake] suppressed send to ${input.to} — subject: ${input.subject}`,
    );
    const id = `fake_${Math.random().toString(36).slice(2, 12)}`;
    return { providerMessageId: id };
  }
}

export function fakeEmailProvider(): EmailProvider {
  return new FakeEmailProvider();
}
