import { getBranding, getAlertPhone, getMailingAddress, brandLogoUrl, serviceDb, getInboundSettings, listNeverLog } from "@bis/db";
import { BrandingPanel } from "@/components/branding-panel";
import { AlertPhoneCard } from "@/components/alert-phone-card";
import { BackToSetup } from "@/components/back-to-setup";
import { PageHeader } from "@/components/page-header";
import { NeverLogList } from "@/components/never-log-list";
import { Card, CardContent } from "@/components/ui/card";
import { requireNotTechnician } from "@/lib/auth";
import { resolveSmsSender } from "@/lib/sms/sender";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { loggableError } from "@/lib/loggable-error";
import { requestLocale } from "@/lib/i18n/request-locale";
import type { Locale } from "@/lib/i18n/locale";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { setBrandingAction, removeBrandLogoAction, restoreBrandLogoAction } from "./actions";
import { addNeverLogAction, removeNeverLogAction, type NeverLogView } from "../never-log-actions";

export const dynamic = "force-dynamic";

/**
 * The client's own door onto their branding — and, alongside it, the one
 * other account fact 0035_alert_phone.sql says a client should be able to
 * SEE even though only the agency can change it: where alert texts go.
 *
 * Deliberately NOT the Settings page. That one also carries custom-field
 * definitions, blueprints and the client-access switch, so opening it to
 * clients would make every panel and every query on it conditional — and one
 * missed condition leaks agency data. That is the shape of the M2 near-miss,
 * where dashboard/layout.tsx held the only guard on three agency-wide
 * serviceDb() reads and admitting clients would have exposed every account.
 *
 * What keeps this page safe to expose is not "branding and nothing else" —
 * it is that every read on it is UNCONDITIONAL and already known to be safe
 * for this account's own users to see (`getBranding`, `getMailingAddress` and
 * `getAlertPhone` are all just `accounts_member_read` reads of columns the
 * client's own RLS already returns; `AlertPhoneCard` below renders with no `action`, so there
 * is no write path here to gate at all). `resolveSmsSender` below is the
 * same shape: it reads THE gate's own tables via `serviceDb()` and hands
 * the card only the derived boolean, never the A2P/carrier detail behind
 * it — so a client whose agency saved a number but never finished
 * registration reads a qualified claim instead of a present-tense one that
 * is not yet true (the send path's own gate is `resolveSmsSender`, sender.ts
 * — this reads it purely to decide which sentence is honest right now, not
 * as a second gate). Every read above stays unconditional.
 *
 * S-06 part 2 adds ONE conditional read, gated on `access.canManage` (the
 * agency, or this account's Owner; plan G8): the Never record LIST itself.
 * Staff never read it and never see it. Its write path is the two
 * Owner-guarded actions in ../never-log-actions.ts (`requireAccountOwner`
 * before any database call), never this page.
 *
 * S-10 T6: the person's own preference and the account's language (the same
 * `accounts.language` read the Never record card used to make only for the
 * Owner) are now read UNCONDITIONALLY, for every role — the resolved locale
 * drives the page's own title, `BrandingPanel` and `AlertPhoneCard` too, not
 * only the Owner-only list.
 */
export default async function BrandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ from?: string; locale?: string }>;
}) {
  const { accountId } = await params;
  // Set by the setup wizard's links, and by nothing else — the breadcrumb
  // below appears only for someone who arrived mid-flow. The wizard is
  // agency-only, so a client reaching their own branding page never sees it.
  // `locale` is the QA override only (request-locale.ts: off unless BIS_I18N_QA, never on Vercel).
  const { from, locale: localeParam } = await searchParams;
  // Redirects a client asking for another account to their own, and refuses a
  // client whose access is switched off. The agency passes straight through —
  // they reach the same panel from Settings, so this route works for them too
  // rather than 404ing in a way someone would later have to debug.
  const access = await requireNotTechnician(accountId);

  // S-06 part 2: the Never record LIST, for the agency and Owners only (plan G8); a failed list
  // read is the list's own error state, never the page's.
  const neverLogRows = access.canManage
    ? listNeverLog(serviceDb(), accountId).then(
        (rows) => rows.map((e) => ({ id: e.id, pattern: e.pattern, kind: e.kind })),
        (e: unknown) => { console.error(`branding: account ${accountId} never-record list read failed: ${loggableError(e)}`); return null; },
      )
    : Promise.resolve(null);

  // serviceDb for the READS, matching every other in-account read of this
  // row. It changes no boundary: accounts_member_read already returns the
  // whole row to this account's own users. The branding WRITE is the one
  // that moved to the RLS-enforced client — see ./actions.ts. alert_phone
  // has no write here at all — AlertPhoneCard renders with no `action`,
  // which is what makes it read-only rather than merely disabled-looking.
  //
  // S-10 T6: `prefs` and `accountRead` used to be read only inside the
  // Owner-only Never record branch; every role now needs them for the
  // page's OWN locale, so they move up here, beside every other
  // unconditional read.
  const [branding, mailingAddress, alertPhone, smsGate, replies, prefs, accountRead, neverLogEntries] = await Promise.all([
    getBranding(serviceDb(), accountId),
    getMailingAddress(serviceDb(), accountId),
    getAlertPhone(serviceDb(), accountId),
    // The SAME gate the send path (and the agency's own Settings copy of
    // this card) consults — never re-derived. Only `!smsGate.ok` crosses
    // into the card; the reason never does.
    resolveSmsSender(serviceDb(), accountId),
    // Read-only here too (S-06 part 1, Task 10): the "where your customers'
    // replies go" line under the reply-to hint. No write path exists on
    // this page, same shape as alert_phone above.
    getInboundSettings(serviceDb(), accountId),
    getPersonPrefs(),
    serviceDb().from("accounts").select("language").eq("id", accountId).maybeSingle(),
    neverLogRows,
  ]);

  if (accountRead.error) {
    console.error(`branding: account ${accountId} language read failed: ${loggableError(accountRead.error)}`);
  }
  const accountRow = accountRead.data as { language?: string | null } | null;
  // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
  const accountLanguage = { language: (accountRow?.language as Locale | null | undefined) ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language }, { locale: localeParam });
  const neverLogCard: { entries: NeverLogView[] | null; locale: Locale } | undefined =
    access.canManage ? { entries: neverLogEntries, locale } : undefined;

  return (
    <div className="space-y-6">
      {from === "setup" ? <BackToSetup accountId={accountId} /> : null}
      <PageHeader title={t(m, "branding.clientTitle", locale)} />
      <BrandingPanel
        // Remount when the ACCOUNT changes, so the panel's own state cannot
        // carry one account's unsaved selections into another's fields on a
        // client-side navigation and save them over real values. The Settings
        // page keys on the same invariant, for the same reason.
        key={accountId}
        // Selects the whole client-voice copy set, not just the heading —
        // see panel-copy.ts. The panel suppresses its own card title for this
        // audience, because the PageHeader above already prints it.
        audience="client"
        brandName={branding.brandName}
        replyToEmail={branding.replyToEmail}
        mailingAddress={mailingAddress}
        brandColor={branding.brandColor}
        brandNeutral={branding.brandNeutral}
        brandCorners={branding.brandCorners}
        brandType={branding.brandType}
        brandMode={branding.brandMode}
        logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
        replyRoute={replies}
        // Not .bind() for these two: setBrandingAction's shape is (accountId,
        // formData, locale) and restoreBrandLogoAction's is (accountId, path,
        // locale) — in both, the single remaining arg this prop supplies
        // sits BETWEEN the two bound ones, which .bind() cannot skip over.
        // removeBrandLogoAction has no such middle argument, so .bind() still works for it.
        action={(formData: FormData) => setBrandingAction(accountId, formData, locale)}
        removeLogoAction={removeBrandLogoAction.bind(null, accountId, locale)}
        restoreLogoAction={(path: string) => restoreBrandLogoAction(accountId, path, locale)}
        locale={locale}
      />
      {/* S-06 part 2: its own card, OUTSIDE the branding form (plan G6), and no primary of its own. */}
      {neverLogCard !== undefined ? (
        <Card id="never-record">
          <CardContent className="pt-6">
            <NeverLogList entries={neverLogCard.entries} add={addNeverLogAction.bind(null, accountId)}
              remove={removeNeverLogAction.bind(null, accountId)} locale={neverLogCard.locale} idPrefix="branding" />
          </CardContent>
        </Card>
      ) : null}
      <AlertPhoneCard
        isAgency={false}
        accountId={accountId}
        alertPhone={alertPhone}
        // Not ready when the gate itself is closed OR the stored number is
        // one this account already owns (`smsGate.ownedNumbers` —
        // `resolveSmsSender`'s widened `testing` OR `live` set, the same
        // one `refusesAlertLoop` refuses against at send time). A gate that
        // is otherwise "ok" still refuses THIS specific send when the alert
        // phone loops back to the account's own number, so `!smsGate.ok`
        // alone was the narrow, pre-widening comparison read back in here.
        smsNotReady={!smsGate.ok || (alertPhone !== null && smsGate.ownedNumbers.includes(alertPhone))}
        locale={locale}
      />
    </div>
  );
}
