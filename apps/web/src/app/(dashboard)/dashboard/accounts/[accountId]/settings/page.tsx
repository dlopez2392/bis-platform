import { Suspense } from "react";
import { Braces, SlidersHorizontal } from "lucide-react";
import { serviceDb, listCustomFields, listCustomValues, listBlueprints, getBranding, getMailingAddress,
         getSendingIdentity, brandLogoUrl, getSiteForAccount, countTrafficDays, type CustomFieldDef } from "@bis/db";
import { SubmitButton } from "../../submit-button";
import { createFieldAction, upsertValueAction, setFromEmailAction, setReportEmailsAction, setAlertPhoneAction,
         startAlertPhoneVerificationAction, confirmAlertPhoneVerificationAction } from "./actions";
import { setBrandingAction, removeBrandLogoAction, restoreBrandLogoAction } from "../branding/actions";
import { SaveBlueprintDialog } from "./save-blueprint-dialog";
import { ApplyBlueprintDialog } from "./apply-blueprint-dialog";
import { ClientAccessSection } from "./client-access-section";
import { ClientAccessSkeleton } from "./client-access-panel";
import { WebsiteSection } from "./website-section";
import { LinkSiteSkeleton } from "../website/link-site-card";
import { SendingAddressCard } from "./sending-address-card";
import { WeeklyReportCard } from "./weekly-report-card";
import { BillingSection, BillingCardSkeleton } from "./billing-section";
import { AlertPhoneCard } from "@/components/alert-phone-card";
import { resolveSmsSender } from "@/lib/sms/sender";
import { BrandingPanel } from "@/components/branding-panel";
import { captureBlueprintAction, applyBlueprintAction } from "../../../blueprints/actions";
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
  const [fields, values, blueprints, account, branding, mailingAddress, sendingIdentity, site, daysStored, smsGate] = await Promise.all([
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
    getMailingAddress(db, accountId),
    getSendingIdentity(db, accountId),
    getSiteForAccount(db, accountId),
    countTrafficDays(db, accountId),
    // The same gate the send path itself consults (resolveSmsSender), read
    // here purely to decide whether AlertPhoneCard's "nothing will actually
    // send yet" notice applies — not a guard, just the fact behind one.
    resolveSmsSender(db, accountId),
  ]);

  const boundCreateField = createFieldAction.bind(null, accountId);
  const boundUpsertValue = upsertValueAction.bind(null, accountId);
  // accountId is bound here, server-side. It must never travel as a form field.
  const boundSetBranding = setBrandingAction.bind(null, accountId);
  const boundRemoveLogo = removeBrandLogoAction.bind(null, accountId);
  const boundRestoreLogo = restoreBrandLogoAction.bind(null, accountId);
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
          <>
            {/* D-086: the "apply one later" the Add company dialog promises. */}
            <ApplyBlueprintDialog
              action={applyBlueprintAction.bind(null, accountId)}
              blueprints={blueprints.map((b) => ({ id: b.id, name: b.name }))}
            />
            <SaveBlueprintDialog
              action={captureBlueprintAction.bind(null, accountId)}
              existing={blueprints.map((b) => ({ name: b.name, version: b.version }))}
            />
          </>
        }
      />
      <div className="space-y-6 p-6">
        {/* The two cards that wait on a third party — Clerk's member list here,
            Vercel's project list further down — each stream in their own
            boundary, so neither holds the rest of Settings. Before this the
            page painted nothing until both had answered, and the palette's
            jump to Settings sat on the previous page past e2e's 10s
            (client-access-section.tsx). No route-level loading.tsx: the hash
            scroll runs once, on the first commit, and a loading.tsx would be
            that commit, with none of the page's anchors in it. */}
        <Suspense fallback={<ClientAccessSkeleton />}>
          <ClientAccessSection
            accountId={accountId}
            clerkOrgId={account.clerk_org_id}
            enabled={account.client_access_enabled}
          />
        </Suspense>
        {/* Billing (M7a step 3): streamed in its own boundary so a slow
            billing read never holds the rest of Settings, and a failed one
            renders its own error card (billing-section.tsx). */}
        <Suspense fallback={<BillingCardSkeleton />}>
          <BillingSection accountId={accountId} />
        </Suspense>
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
          mailingAddress={mailingAddress}
          brandColor={branding.brandColor}
          brandNeutral={branding.brandNeutral}
          brandCorners={branding.brandCorners}
          brandType={branding.brandType}
          brandMode={branding.brandMode}
          logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
          action={boundSetBranding}
          removeLogoAction={boundRemoveLogo}
          restoreLogoAction={boundRestoreLogo}
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
        <Suspense fallback={<LinkSiteSkeleton linkedDomain={site?.domain ?? null} />}>
          <WebsiteSection
            accountId={accountId}
            linked={site ? { vercelProjectId: site.vercelProjectId, domain: site.domain } : null}
            daysStored={daysStored}
          />
        </Suspense>
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
                  {/* Review round 2, minor 3: a browser-side refusal of the
                      reserved "referred_by" key (createFieldAction's own
                      server-side throw, round 1 m4, lands on the dashboard's
                      generic error page — this form has no result-returning
                      wiring to show it inline, so the server check is a
                      backstop, not the primary UX). Behaviour re-verified
                      by page.test.ts (round 3, item 2): referred_by refused,
                      referred_by_2 and gate_code allowed, Gate_code (upper-
                      case) refused by the shape half. Review round 3, item
                      1: `title` is what a browser shows for ANY pattern
                      mismatch (the shape half fails on "Gate Code" too) and
                      as a plain hover tooltip on an EMPTY field, so it must
                      describe the WHOLE pattern, not only the reserved-key
                      half — settings.fieldKeyReserved stays the SERVER-side
                      throw's own message alone. */}
                  <Input
                    id="field-key" name="fieldKey" required
                    pattern="(?!referred_by$)[a-z0-9_]+"
                    title={m["settings.fieldKeyFormat"]}
                  />
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
