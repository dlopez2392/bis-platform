import { shell, escapeHtml, type EmailBrand } from "./shell";
import type { PublicLocale } from "@/lib/forms/public-strings";

export type LeadReceiptInput = {
  brand: EmailBrand;
  /** The language the form was submitted in — the only signal we have for
   *  the language the person reads. */
  locale: PublicLocale;
  /** Attacker-supplied: typed into a public form. Null when the form asked
   *  for no name, or the person left it blank. */
  firstName: string | null;
  /** Whether a reply to this message reaches the company. False when the
   *  account has no reply-to address configured: inviting a reply that would
   *  land in the platform's sending mailbox is worse than saying nothing. */
  canReply: boolean;
};

const COPY = {
  en: {
    subject: (brand: string) => `We received your message — ${brand}`,
    greeting: (name: string | null) => (name ? `Hi ${name},` : "Hi,"),
    body: "Thanks for reaching out. We received your message and will be in touch shortly.",
    reply: "If you'd like to add anything, just reply to this email.",
  },
  es: {
    subject: (brand: string) => `Recibimos tu mensaje — ${brand}`,
    greeting: (name: string | null) => (name ? `Hola ${name}:` : "Hola:"),
    body: "Gracias por escribirnos. Recibimos tu mensaje y nos pondremos en contacto pronto.",
    reply: "Si quieres agregar algo, solo responde a este correo.",
  },
} as const;

export function leadReceiptSubject(locale: PublicLocale, brandName: string): string {
  return COPY[locale].subject(brandName);
}

/**
 * The receipt a person gets after filling in a company's form.
 *
 * Customer-facing, like `bookingConfirmationEmail`: a small brand header and
 * two plain sentences, no table, no button — there is nothing for the reader
 * to do, and a lead form's auto-reply is the one email most likely to be the
 * company's first impression. It exists because bis-rgv.com's own contact
 * form sent one before it moved onto the platform, and a form that goes
 * silent after "Submit" reads as a form that did not work.
 */
export function leadReceiptEmail(input: LeadReceiptInput): { html: string; text: string } {
  const copy = COPY[input.locale];
  const greeting = copy.greeting(input.firstName?.trim() || null);

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 12px;">${escapeHtml(copy.body)}</p>
    ${input.canReply ? `<p style="margin:0;color:#71717a;">${escapeHtml(copy.reply)}</p>` : ""}
  `);

  // Composed, never derived by stripping tags — the version a human would
  // have written, and what a text-only client shows.
  const text = [
    greeting,
    "",
    copy.body,
    ...(input.canReply ? ["", copy.reply] : []),
  ].join("\n");

  return { html, text };
}
