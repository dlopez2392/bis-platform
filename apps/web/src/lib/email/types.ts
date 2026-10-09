export type SendEmailInput = {
  to: string;
  fromName: string;
  /** Overrides the provider's configured from-address for THIS SEND only.
   *
   *  Optional so every existing caller is unchanged: absent means the platform
   *  address, exactly as before. That is what keeps the lead alert on
   *  crm@bis-rgv.com without it having to say so — see spec §3, where sending
   *  a client's own staff mail from their own domain is a deliverability risk
   *  on the one message that must never be quarantined. */
  fromAddress?: string;
  replyTo?: string;
  subject: string;
  body: string;
  /** The rich part. Optional so every existing caller is unchanged: absent
   *  means a text-only send, exactly as before.
   *
   *  Never send this WITHOUT `body`. The text alternative is what keeps a
   *  branded message out of the spam bucket and readable in a text client, and
   *  it is composed deliberately by each template rather than derived by
   *  stripping tags. */
  html?: string;
  /** Extra headers, passed to Resend as they are (its `headers` field, plan
   *  X1). Only the email gate sets them: the RFC 8058 List-Unsubscribe and
   *  List-Unsubscribe-Post pair on customer email (consent PR-3). */
  headers?: Record<string, string>;
  /** Resend tags (D-016 item 1), passed through as-is: the account id and,
   *  when known, the contact id — only the email gate sets these, so a
   *  bounce/complaint webhook can attribute an address back to its account
   *  without falling back to the messages row. Name/value are each ASCII
   *  letters, numbers, `_` or `-` only (Resend's rule); a uuid satisfies it.
   *  Echoed back on the webhook event as `data.tags`
   *  (resend.com/docs/dashboard/emails/tags: "After the email is sent, the
   *  tag is included in the webhook event"). */
  tags?: { name: string; value: string }[];
};

export type SendEmailResult = { providerMessageId: string };

export interface EmailProvider {
  /** True when this provider does not actually deliver mail. */
  readonly isFake: boolean;
  /** Set when a real provider is forced outside production; all mail goes here. */
  readonly redirectTo?: string;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
