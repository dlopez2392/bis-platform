import { sendEmailOrThrow } from "@/lib/consent/email-gate";
import { emailBrand } from "@/lib/email/templates/shell";
import { ownerLineLockoutEmail } from "@/lib/email/templates/owner-line";
import { firstName } from "@/lib/owner-line/names";
import { loggableError } from "@/lib/loggable-error";
import type { Locale } from "@/lib/i18n/locale";

/**
 * F-032 §4.2: "email the person and the account's Owner ('Someone entered the wrong PIN 3 times from your phone at
 * 2:14 PM')". Each recipient in their own language (users.language, then the account's, then English), deduplicated
 * by address, each send in its own try/catch so one failure never costs the other. Never throws.
 * THIS MODULE REACHES @bis/db AT MODULE SCOPE, through email-gate.ts:1-5 and templates/shell.ts:1, so a TeXML route
 * must never import it statically (route.ts:219-226; SC-18). owner-pin imports it with await import() INSIDE after(),
 * once the caller has been answered, and captures the lock instant (`at`) before calling after()
 * (owner-pin/route.ts lockoutEmailsAfterResponse; the module's chunk is about 613 KB with the catalogue, which must
 * never load on Telnyx's answer deadline). The await import("@bis/db") below is for this file's own reads.
 */
export async function sendOwnerLineLockoutEmails(
  p: { accountId: string; userId: string; lockedUntil: string; at: Date; accountLanguage: "en" | "es" | null },
  deps: { send: typeof sendEmailOrThrow } = { send: sendEmailOrThrow },
): Promise<void> {
  try {
    const { serviceDb, listAccountTeam, getBranding, readAccountTimezone } = await import("@bis/db");
    const db = serviceDb();
    const [team, branding, zoneRead] = await Promise.all([
      listAccountTeam(db, p.accountId), getBranding(db, p.accountId), readAccountTimezone(db, p.accountId),
    ]);
    const zone = zoneRead ?? "America/Chicago";
    const brand = emailBrand(branding);
    const person = team.find((x) => x.userId === p.userId);
    const recipients = new Map<string, { to: string; language: "en" | "es" | null; forSelf: boolean }>();
    // Keyed by the lowercased address; the person goes in FIRST and is never overwritten, so a locked-out Owner gets
    // the "from your phone" email, not the one about "Ana's phone".
    const key = (email: string) => email.trim().toLowerCase();
    if (person) recipients.set(key(person.email), { to: person.email, language: person.language, forSelf: true });
    for (const o of team.filter((x) => x.role === "owner")) {
      if (!recipients.has(key(o.email))) recipients.set(key(o.email), { to: o.email, language: o.language, forSelf: false });
    }
    // ICU writes a narrow no-break space before AM/PM; a plain space reads the same and matches every other email.
    const at = (iso: Date | string, locale: Locale) => new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US",
      { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(/\u202F/g, " ");
    for (const r of recipients.values()) {
      const to = r.to;
      const locale: Locale = r.language ?? p.accountLanguage ?? "en";
      const email = ownerLineLockoutEmail({
        brand, locale, forSelf: r.forSelf, personName: firstName(person?.name ?? null),
        time: at(p.at, locale), until: at(p.lockedUntil, locale),
      });
      try {
        await deps.send({ accountId: p.accountId, kind: "operator.owner_line_lockout", to, fromName: brand.name,
          subject: email.subject, body: email.text, html: email.html });
      } catch (e) {
        // loggableError (review m-1): a provider's rejection can quote the recipient ("550 <ana@…>: recipient rejected").
        console.error(`owner line lockout email failed for one recipient, accountId ${p.accountId}: ${loggableError(e)}`);
      }
    }
  } catch (e) {
    console.error(`owner line lockout emails could not be prepared, accountId ${p.accountId}: ${loggableError(e)}`);
  }
}
