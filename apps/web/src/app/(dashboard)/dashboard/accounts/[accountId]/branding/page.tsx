import { getBranding, getAlertPhone, brandLogoUrl, serviceDb } from "@bis/db";
import { BrandingPanel } from "@/components/branding-panel";
import { AlertPhoneCard } from "@/components/alert-phone-card";
import { BackToSetup } from "@/components/back-to-setup";
import { PageHeader } from "@/components/page-header";
import { requireAccountAccess } from "@/lib/auth";
import { resolveSmsSender } from "@/lib/sms/sender";
import { m } from "@/lib/messages";
import { setBrandingAction } from "./actions";

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
 * for this account's own users to see (`getBranding` and `getAlertPhone` are
 * both just `accounts_member_read` reads of columns the client's own RLS
 * already returns; `AlertPhoneCard` below renders with no `action`, so there
 * is no write path here to gate at all). `resolveSmsSender` below is the
 * same shape: it reads THE gate's own tables via `serviceDb()` and hands
 * the card only the derived boolean, never the A2P/carrier detail behind
 * it — so a client whose agency saved a number but never finished
 * registration reads a qualified claim instead of a present-tense one that
 * is not yet true (the send path's own gate is `resolveSmsSender`, sender.ts
 * — this reads it purely to decide which sentence is honest right now, not
 * as a second gate). There is still no branch here for a future edit to get
 * wrong — only more reads that share that property.
 */
export default async function BrandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { accountId } = await params;
  // Set by the setup wizard's links, and by nothing else — the breadcrumb
  // below appears only for someone who arrived mid-flow. The wizard is
  // agency-only, so a client reaching their own branding page never sees it.
  const { from } = await searchParams;
  // Redirects a client asking for another account to their own, and refuses a
  // client whose access is switched off. The agency passes straight through —
  // they reach the same panel from Settings, so this route works for them too
  // rather than 404ing in a way someone would later have to debug.
  await requireAccountAccess(accountId);

  // serviceDb for the READS, matching every other in-account read of this
  // row. It changes no boundary: accounts_member_read already returns the
  // whole row to this account's own users. The branding WRITE is the one
  // that moved to the RLS-enforced client — see ./actions.ts. alert_phone
  // has no write here at all — AlertPhoneCard renders with no `action`,
  // which is what makes it read-only rather than merely disabled-looking.
  const [branding, alertPhone, smsGate] = await Promise.all([
    getBranding(serviceDb(), accountId),
    getAlertPhone(serviceDb(), accountId),
    // The SAME gate the send path (and the agency's own Settings copy of
    // this card) consults — never re-derived. Only `!smsGate.ok` crosses
    // into the card; the reason never does.
    resolveSmsSender(serviceDb(), accountId),
  ]);

  return (
    <div className="space-y-6">
      {from === "setup" ? <BackToSetup accountId={accountId} /> : null}
      <PageHeader title={m["branding.clientTitle"]} />
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
        brandColor={branding.brandColor}
        brandNeutral={branding.brandNeutral}
        brandCorners={branding.brandCorners}
        brandType={branding.brandType}
        brandMode={branding.brandMode}
        logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
        action={setBrandingAction.bind(null, accountId)}
      />
      <AlertPhoneCard
        isAgency={false}
        accountId={accountId}
        alertPhone={alertPhone}
        smsNotReady={!smsGate.ok}
      />
    </div>
  );
}
