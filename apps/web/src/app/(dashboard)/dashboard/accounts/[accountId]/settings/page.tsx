import { Braces, SlidersHorizontal } from "lucide-react";
import { clerkClient } from "@clerk/nextjs/server";
import { serviceDb, listCustomFields, listCustomValues, listBlueprints, getBranding,
         getSendingIdentity, brandLogoUrl, getSiteForAccount, countTrafficDays, type CustomFieldDef } from "@bis/db";
import { SubmitButton } from "../../submit-button";
import { createFieldAction, upsertValueAction, setClientAccessAction, inviteClientAdminAction,
         setFromEmailAction, setReportEmailsAction, setAlertPhoneAction,
         startAlertPhoneVerificationAction, confirmAlertPhoneVerificationAction } from "./actions";
import { setBrandingAction } from "../branding/actions";
import { SaveBlueprintDialog } from "./save-blueprint-dialog";
import { ClientAccessPanel, type ClientAccessMember } from "./client-access-panel";
import { SendingAddressCard } from "./sending-address-card";
import { WeeklyReportCard } from "./weekly-report-card";
import { AlertPhoneCard } from "@/components/alert-phone-card";
import { LinkSiteCard, type VercelProjectOption } from "../website/link-site-card";
import { saveSiteAction, testSiteConnectionAction, unlinkSiteAction } from "../website/actions";
import { vercelAnalyticsFromEnv } from "@/lib/vercel/web-analytics";
import { resolveSmsSender } from "@/lib/sms/sender";
import { BrandingPanel } from "@/components/branding-panel";
import { captureBlueprintAction } from "../../../blueprints/actions";
import { BackToSetup } from "@/components/back-to-setup";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dbForRequest } from "@/lib/db";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

const DATA_TYPE_LABEL: Record<CustomFieldDef["data_type"], string> = {
  text: m["settings.dataType.text"],
  number: m["settings.dataType.number"],
  date: m["settings.dataType.date"],
  checkbox: m["settings.dataType.checkbox"],
  single_select: m["settings.dataType.singleSelect"],
};

export default async function CrmSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { accountId } = await params;
  // Set by the setup wizard's links, and by nothing else — the breadcrumb
  // below appears only for someone who arrived mid-flow.
  const { from } = await searchParams;
  await requireAgencyOnlyAccountAccess(accountId);
  const db = await dbForRequest();
  const [fields, values, blueprints, account, branding, sendingIdentity, site, daysStored, projects, smsGate] = await Promise.all([
    listCustomFields(db, accountId, "contact"),
    listCustomValues(db, accountId),
    // Agency-wide, not account-scoped — this account is just where the
    // capture happens. Passed down so the save dialog can warn before a
    // recapture silently overwrites an existing blueprint's bundle: capture
    // has no version history and no undo.
    //
    // Deliberately on serviceDb(), not the request-scoped db above:
    // blueprints RLS is `app.is_agency()` alone (agency-only resource), so a
    // client user's RLS-enforcing token would see zero rows here, silently
    // breaking the recapture-overwrite warning for them. Flagged in the M2
    // task-4 report as a cross-account (cross-tenant, agency-wide) read on
    // an in-account surface — worth the owner's judgment on whether clients
    // should see this at all.
    listBlueprints(serviceDb()),
    db.from("accounts").select("clerk_org_id, client_access_enabled, report_emails, alert_phone").eq("id", accountId).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`settings: account lookup failed: ${error.message}`);
        if (!data) throw new Error("settings: account not found");
        return data;
      }),
    getBranding(db, accountId),
    getSendingIdentity(db, accountId),
    getSiteForAccount(db, accountId),
    countTrafficDays(db, accountId),
    // Listing Vercel projects needs the platform token (runbook step 1).
    // Without it the card still renders — an already-linked site keeps
    // showing its domain; a new one cannot be picked — and says why. Same
    // fail-soft shape as the member list below: one missing integration
    // must never take the whole settings page offline.
    (async (): Promise<{ list: VercelProjectOption[]; unavailable: boolean }> => {
      try {
        return { list: await vercelAnalyticsFromEnv().listProjects(), unavailable: false };
      } catch (e) {
        console.error(`settings: vercel projects unavailable for account ${accountId}: ${String(e)}`);
        return { list: [], unavailable: true };
      }
    })(),
    // The same gate the send path itself consults (resolveSmsSender), read
    // here purely to decide whether AlertPhoneCard's "nothing will actually
    // send yet" notice applies — not a guard, just the fact behind one.
    resolveSmsSender(db, accountId),
  ]);

  // No Clerk->Postgres member sync exists (see design doc §7) — Clerk is the
  // only source of truth for who is seated in this account's organization,
  // so the member list is read live from the Backend API rather than a
  // local table.
  //
  // Unguarded, this call takes the whole page offline on any Clerk 4xx/5xx/
  // rate-limit — including for an accounts row whose Clerk org has been
  // deleted out from under it, which has already happened on this project.
  // That would be uniquely bad here: this is the only page hosting the
  // client-access switch, so an agency admin who needed to reach it to turn
  // access OFF would be unable to load the page at all. Fail soft instead —
  // empty member list, inline note, switch renders regardless.
  const clerk = await clerkClient();
  let members: ClientAccessMember[] = [];
  let pendingInvites: ClientAccessMember[] = [];
  let membersUnavailable = false;
  if (account.clerk_org_id) {
    try {
      const membershipList = await clerk.organizations.getOrganizationMembershipList({
        organizationId: account.clerk_org_id,
      });
      members = membershipList.data.map((membership) => ({
        id: membership.id,
        email: membership.publicUserData?.identifier ?? m["common.unavailable"],
        role: membership.role.replace(/^org:/, "").replace(/^\w/, (c) => c.toUpperCase()),
      }));

      // Pending invitations too. Without these the panel lists only people who
      // have already ACCEPTED, so after inviting someone the agency sees no
      // change at all — the success toast is transient and gone on reload,
      // leaving no way to tell whether an invite was ever sent. Re-inviting
      // the same address then fails with the generic error.
      const invitationList = await clerk.organizations.getOrganizationInvitationList({
        organizationId: account.clerk_org_id,
        status: ["pending"],
      });
      pendingInvites = invitationList.data.map((invitation) => ({
        id: invitation.id,
        email: invitation.emailAddress,
        role: invitation.role.replace(/^org:/, "").replace(/^\w/, (c) => c.toUpperCase()),
      }));
    } catch (e) {
      console.error(`settings: member list fetch failed for org ${account.clerk_org_id}: ${String(e)}`);
      membersUnavailable = true;
    }
  }

  const boundCreateField = createFieldAction.bind(null, accountId);
  const boundUpsertValue = upsertValueAction.bind(null, accountId);
  const boundSetAccess = setClientAccessAction.bind(null, accountId);
  const boundInvite = inviteClientAdminAction.bind(null, accountId);
  // accountId is bound here, server-side. It must never travel as a form field.
  const boundSetBranding = setBrandingAction.bind(null, accountId);
  const boundSetFromEmail = setFromEmailAction.bind(null, accountId);
  const boundSetReportEmails = setReportEmailsAction.bind(null, accountId);
  const boundSetAlertPhone = setAlertPhoneAction.bind(null, accountId);
  const boundStartAlertPhoneVerification = startAlertPhoneVerificationAction.bind(null, accountId);
  const boundConfirmAlertPhoneVerification = confirmAlertPhoneVerificationAction.bind(null, accountId);
  return (
    <>
      {from === "setup" ? <BackToSetup accountId={accountId} /> : null}
      <PageHeader
        title={m["settings.title"]}
        actions={
          <SaveBlueprintDialog
            action={captureBlueprintAction.bind(null, accountId)}
            existing={blueprints.map((b) => ({ name: b.name, version: b.version }))}
          />
        }
      />
      <div className="space-y-6 p-6">
        <ClientAccessPanel
          enabled={account.client_access_enabled}
          members={members}
          pendingInvites={pendingInvites}
          membersUnavailable={membersUnavailable}
          setAccessAction={boundSetAccess}
          inviteAction={boundInvite}
        />
        <BrandingPanel
          // Remount when the ACCOUNT changes, so the panel's own state cannot
          // carry one account's values into another's fields on a client-side
          // navigation between two settings pages.
          //
          // This used to key on the stored colour, which worked only while
          // colour was the panel's single piece of state. It now holds five,
          // and two accounts that both have no colour share the key "" — so
          // navigating between them reused the component instance and carried
          // account A's radio selections into account B's form, ready to be
          // saved over B's real values. The account id is the actual invariant
          // this panel belongs to; keying on a value it happens to display was
          // always a proxy for it.
          key={accountId}
          brandName={branding.brandName}
          replyToEmail={branding.replyToEmail}
          brandColor={branding.brandColor}
          brandNeutral={branding.brandNeutral}
          brandCorners={branding.brandCorners}
          brandType={branding.brandType}
          brandMode={branding.brandMode}
          logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
          action={boundSetBranding}
        />
        <SendingAddressCard
          fromEmail={sendingIdentity.fromEmail}
          action={boundSetFromEmail}
        />
        <WeeklyReportCard
          reportEmails={account.report_emails}
          action={boundSetReportEmails}
        />
        <AlertPhoneCard
          isAgency
          accountId={accountId}
          alertPhone={account.alert_phone}
          smsNotReady={!smsGate.ok}
          clearAction={boundSetAlertPhone}
          startVerificationAction={boundStartAlertPhoneVerification}
          confirmVerificationAction={boundConfirmAlertPhoneVerification}
        />
        <LinkSiteCard
          // Same reason as BrandingPanel's key: the card holds the picked
          // project and typed domain in state, which must not carry from
          // one account's settings page into another's on a client-side
          // navigation.
          key={accountId}
          projects={projects.list}
          projectsUnavailable={projects.unavailable}
          linked={site ? { vercelProjectId: site.vercelProjectId, domain: site.domain } : null}
          daysStored={daysStored}
          saveAction={saveSiteAction.bind(null, accountId)}
          testAction={testSiteConnectionAction.bind(null, accountId)}
          unlinkAction={unlinkSiteAction.bind(null, accountId)}
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <Card id="custom-fields" className="scroll-mt-24">
            <CardHeader>
              <CardTitle>{m["settings.customFields"]}</CardTitle>
              <CardDescription>{m["settings.customFieldsBody"]}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <form action={boundCreateField} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="field-name">{m["settings.fieldName"]}</Label>
                  <Input id="field-name" name="name" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="field-key">{m["settings.fieldKey"]}</Label>
                  <Input id="field-key" name="fieldKey" required pattern="[a-z0-9_]+" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="field-type">{m["settings.dataType"]}</Label>
                  <Select name="dataType" defaultValue="text">
                    <SelectTrigger id="field-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">{m["settings.dataType.text"]}</SelectItem>
                      <SelectItem value="number">{m["settings.dataType.number"]}</SelectItem>
                      <SelectItem value="date">{m["settings.dataType.date"]}</SelectItem>
                      <SelectItem value="checkbox">{m["settings.dataType.checkbox"]}</SelectItem>
                      <SelectItem value="single_select">{m["settings.dataType.singleSelect"]}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="field-options">{m["settings.options"]}</Label>
                  <Input id="field-options" name="options" />
                </div>
                <SubmitButton>{m["settings.addField"]}</SubmitButton>
              </form>

              {fields.length === 0 ? (
                <EmptyState icon={SlidersHorizontal} title={m["settings.noFields"]} />
              ) : (
                <ul className="flex flex-col">
                  {fields.map((f) => (
                    <li
                      key={f.id}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--row-line)] py-[7px] text-[13px] first:border-t-0"
                    >
                      <span className="font-medium text-card-foreground">{f.name}</span>
                      <code className="font-mono text-xs text-muted-foreground">{f.field_key}</code>
                      <span className="text-xs text-muted-foreground">
                        · {DATA_TYPE_LABEL[f.data_type]}
                      </span>
                      {f.options.length > 0 && (
                        <span className="text-xs text-muted-foreground">[{f.options.join(", ")}]</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card id="custom-values" className="scroll-mt-24">
            <CardHeader>
              <CardTitle>{m["settings.customValues"]}</CardTitle>
              <CardDescription>{m["settings.customValuesBody"]}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <form action={boundUpsertValue} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="value-name">{m["settings.valueName"]}</Label>
                  <Input id="value-name" name="name" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="value-key">{m["settings.valueKey"]}</Label>
                  <Input id="value-key" name="valueKey" required pattern="[a-z0-9_]+" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="value-value">{m["settings.value"]}</Label>
                  <Input id="value-value" name="value" />
                </div>
                <SubmitButton>{m["settings.saveValue"]}</SubmitButton>
              </form>

              {values.length === 0 ? (
                <EmptyState icon={Braces} title={m["settings.noValues"]} />
              ) : (
                <ul className="flex flex-col">
                  {values.map((v) => (
                    <li
                      key={v.id}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--row-line)] py-[7px] text-[13px] first:border-t-0"
                    >
                      <span className="font-medium text-card-foreground">{v.name}</span>
                      <code className="font-mono text-xs text-muted-foreground">{v.value_key}</code>
                      <span className="text-xs text-muted-foreground">
                        = {v.value || m["common.none"]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
