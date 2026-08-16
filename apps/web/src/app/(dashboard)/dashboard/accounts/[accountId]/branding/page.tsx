import { getBranding, brandLogoUrl, serviceDb } from "@bis/db";
import { BrandingPanel } from "@/components/branding-panel";
import { PageHeader } from "@/components/page-header";
import { requireAccountAccess } from "@/lib/auth";
import { m } from "@/lib/messages";
import { setBrandingAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The client's own door onto their branding.
 *
 * Deliberately NOT the Settings page. That one also carries custom-field
 * definitions, blueprints and the client-access switch, so opening it to
 * clients would make every panel and every query on it conditional — and one
 * missed condition leaks agency data. That is the shape of the M2 near-miss,
 * where dashboard/layout.tsx held the only guard on three agency-wide
 * serviceDb() reads and admitting clients would have exposed every account.
 *
 * This page fetches branding and nothing else. That is a property of what it
 * reads rather than of a conditional, which is what makes it safe to expose:
 * there is no branch here for a future edit to get wrong.
 */
export default async function BrandingPage({
  params,
}: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  // Redirects a client asking for another account to their own, and refuses a
  // client whose access is switched off. The agency passes straight through —
  // they reach the same panel from Settings, so this route works for them too
  // rather than 404ing in a way someone would later have to debug.
  await requireAccountAccess(accountId);

  // serviceDb for the READ, matching every other in-account read of this row.
  // It changes no boundary: accounts_member_read already returns the whole row
  // to this account's own users. The WRITE is the one that moved to the
  // RLS-enforced client — see ./actions.ts.
  const branding = await getBranding(serviceDb(), accountId);

  return (
    <div className="space-y-6">
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
    </div>
  );
}
