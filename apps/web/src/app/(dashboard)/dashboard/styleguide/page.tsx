import { Inbox } from "lucide-react";
import { requireAgency } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { Meter } from "@/components/meter";
import { DailyChart } from "../accounts/[accountId]/website/daily-chart";
import { DeviceStrip } from "../accounts/[accountId]/website/device-strip";
import { EmptyState } from "@/components/empty-state";
import { ZoneNote } from "@/components/zone-note";
import { LineDownBanner } from "@/components/line-down-banner";
import { UsageStaleBanner } from "@/components/usage-stale-banner";
import { TagChips } from "@/components/tag-chips";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SCREENED_REASONS, screenedClass } from "@bis/db";
import { CLASS_DOT } from "../screened/screened-table";
import { SuggestionCapLine, SuggestionSection, SuggestionSectionSkeleton } from "@/components/proposals/suggestion-section";
import { CALL_AT, EDITS, FIVE, NAMES, NOW, PIPELINE_STAGES, STAGES, ZONE, rows as SUGGESTION_ROWS } from "@/components/proposals/suggestion-specimens";
import { buildSuggestionView } from "@/lib/proposals/view";
import { makeTr } from "@/lib/record/copy";
import { SuggestionDemo } from "./suggestion-demo";
import { buildWorkTrayColumns, WorkTrayDemo } from "./work-tray-demo";
import { LogStatusPill } from "../accounts/[accountId]/activity/log-status-pill";
import { CONFIRM_REPLY_TREATMENTS } from "../accounts/[accountId]/calendar/confirm-reply";
import { DotPill } from "@/components/dot-pill";
import { PHONE_CHECK_TREATMENT } from "@/lib/contacts/phone-country";
import { TEXTS_TREATMENT } from "@/lib/consent/texts-row";
import { EMAIL_TREATMENT } from "@/lib/consent/email-row";
import { BillingBanner } from "@/components/billing-banner";
import { ManageBillingButton } from "../accounts/[accountId]/billing/manage-billing-button";
import { PAYMENT_PROCESSING } from "../accounts/[accountId]/billing/client-status";
import { BILLING_STATUS_TREATMENTS, type BillingStatus } from "@/lib/billing/billing-view";
import { SmsPreview } from "@/components/sms-preview";
import { withOptOut } from "@/lib/sms/opt-out";
import {
  composeSmsReminder, defaultSmsReminderBody, SMS_REMINDER_PREVIEW_INSTANT,
} from "@/lib/automations/sms-reminder-copy";
import { formatWhen } from "@/lib/booking/time";
import { cn } from "@/lib/utils";
import { RailStates } from "./rail-states";
import { ChoiceTilesDemo } from "./choice-tiles-demo";
import { AssignDemo } from "./assign-demo";
import { RelationshipsDemo } from "./relationships-demo";
import { PlacesDemo } from "./places-demo";
import { DocumentsDemo } from "./documents-demo";
import { DocumentsPageDemo } from "./documents-page-demo";
import { HeldEmailsDemo } from "./held-emails-demo";
import { NeverLogDemo } from "./never-log-demo";
import { ForwardingDemo } from "./forwarding-demo";
import { WebchatDemo } from "./webchat-demo";
import { RecordDemo } from "./record-demo";
import { WhoFilter } from "@/components/assign/who-filter";
import { LocaleNavDemo, NavRowGeometry, NAV_LABEL_SPAN_CLASS } from "./locale-nav-demo";
import { requestPseudoMode } from "@/lib/i18n/request-locale";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import { t } from "@/lib/i18n/t";
import { SettingsFieldCards } from "./settings-field-cards";
import { BillingCardStates } from "./billing-card-states";
import { ClientAccessSkeleton } from "@/app/(dashboard)/dashboard/accounts/[accountId]/settings/client-access-panel";
import { LinkSiteSkeleton } from "@/app/(dashboard)/dashboard/accounts/[accountId]/website/link-site-card";
import { PublicBrand } from "@/components/public-brand";
import "@/styles/public-brand.css";
import { EmbedSnippet } from "@/components/embed-snippet";
import "@/app/c/[publicId]/concierge.css";
import { m, type MessageKey } from "@/lib/messages";
import { SpanishBodyFieldDemo } from "./spanish-body-field-demo";

export const dynamic = "force-dynamic";

/** The suggestion card's five states (item 8b-1), built by the real view builder from typed-out rows,
 *  in English, Spanish and the pseudo-locale (+35%), plus a pending row past its 30 days. */
const SUGGESTION_TRS = [
  { key: "en", tr: makeTr("en") }, { key: "es", tr: makeTr("es") }, { key: "pseudo", tr: makeTr("en", true) },
] as const;
const suggestionColumns = () => SUGGESTION_TRS.map(({ key, tr }) => {
  const build = (s: keyof typeof SUGGESTION_ROWS) => buildSuggestionView(SUGGESTION_ROWS[s], {
    tr, zone: ZONE, now: NOW, stages: STAGES, pipelineStages: PIPELINE_STAGES, callerName: "Ana Lopez",
    callStartedAt: CALL_AT, personaName: "Sofía", names: NAMES, viewerId: null,
  });
  return { key, caption: key, views: [...FIVE, "aged" as const].map(build), edits: EDITS.map(build) };
});
/** The section's error state renders no card, so these are never called or sent to the browser. */
const NO_SUGGESTION_ACTIONS = {
  accept: async () => ({ ok: false as const, error: "" }), editAccept: async () => ({ ok: false as const, error: "" }),
  discard: async () => ({ ok: false as const, error: "" }), undo: async () => ({ ok: false as const, error: "" }),
};

/** The same `nav.*` keys the Locale section's en/es columns demonstrate
 *  (Task 6) — one shared array so Task 11's pseudo-locale column below
 *  iterates the exact same set rather than a second, hand-copied list that
 *  could drift from it. */
const NAV_LABEL_KEYS: MessageKey[] = ["nav.contacts", "nav.numbers"];

/** The Manage billing specimen's action: it answers with the page's own
 *  failure sentence and touches nothing (no read, no Stripe), so pressing it
 *  here shows the button's error state without a real portal. */
async function styleguidePortalFailed(): Promise<{ ok: false; error: string }> {
  "use server";
  return { ok: false, error: m["billing.page.portalFailed"] };
}

/**
 * The working index DESIGN.md's definition-of-done refers to ("`/styleguide`
 * page updated if a new component/variant was added").
 *
 * AGENCY-ONLY but reachable in PRODUCTION — danlo's locked decision. That is
 * the whole point: tenant-branding surprises only show up against real
 * production theming, which a dev-only page could never surface.
 *
 * `requireAgency()`, NOT `requireAgencyOnlyAccountAccess()`: this route has no
 * accountId, and that function requires one. A client who types the URL is
 * redirected to "/".
 *
 * Every entry names its file, so this stays an index rather than a poster.
 */
function Section({
  title, file, children,
}: { title: string; file: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {/* F-107 (rider part): `break-all` — a file PATH has no spaces to
            wrap at, so without it this caption's own min-content width (not
            Card's — CardHeader is its own `grid`, ui/card.tsx, and a grid
            item's automatic minimum size is independent of its ancestors')
            held the header open past the card at phone width. */}
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground break-all">
          {file}
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-start gap-3">{children}</CardContent>
    </Card>
  );
}

export default async function StyleguidePage({
  searchParams,
}: {
  // Not a prop of this page before Task 11 — added so `?locale=pseudo` can
  // reach this page.tsx's own `requestPseudoMode` call. Optional: no
  // existing test calls this component directly without it, but a widened
  // required prop would still be a real signature change for no benefit.
  searchParams?: Promise<{ locale?: string }>;
}) {
  await requireAgency();
  const { locale: localeParam } = (await searchParams) ?? {};
  // QA-only (requestPseudoMode is false unless BIS_I18N_QA="1" is set —
  // Playwright's webServer env / CI's e2e job, never Vercel): the third
  // column below, beside Task 6's real en/es ones.
  const pseudo = requestPseudoMode({ locale: localeParam });

  return (
    <>
      <PageHeader title={m["styleguide.title"]} />
      <div className="space-y-6 p-6">
        <p className="max-w-prose text-sm text-muted-foreground">{m["styleguide.body"]}</p>

        <Section title="Ground & light" file="styles/tokens.css · components/ground.tsx">
          {/* The glass ladder: four steps, never more. Each swatch is a token. */}
          <div className="flex w-full flex-wrap gap-3">
            {(["--surface-0", "--surface-1", "--surface-2", "--surface-3"] as const).map((t) => (
              <div key={t} className="flex flex-col gap-1">
                <div className="h-14 w-28 rounded-lg border border-border glass" style={{ backgroundColor: `var(${t})` }} />
                <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t}</span>
              </div>
            ))}
            <div className="flex flex-col gap-1">
              <div className="h-14 w-28 rounded-lg" style={{ backgroundColor: "var(--accent-2)" }} />
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">--accent-2</span>
            </div>
          </div>
          {/* The hero gradient — display size only (≥ 22px), one per screen. */}
          <p className="hero-text font-display text-[30px] leading-none font-[600] tracking-[-0.03em] tabular-nums">1,248</p>
          <div className="flex w-full flex-wrap gap-2">
            <Button>Primary action</Button>
            <Button variant="ghost">Ghost action</Button>
            <Button variant="destructive">Delete</Button>
          </div>
        </Section>

        <Section title="Buttons" file="components/ui/button.tsx">
          {(["default", "destructive", "outline", "secondary", "ghost", "link"] as const).map(
            (variant) => (
              <Button key={variant} variant={variant}>
                {variant}
              </Button>
            ),
          )}
          {(["xs", "sm", "default", "lg"] as const).map((size) => (
            <Button key={size} size={size}>
              size {size}
            </Button>
          ))}
          <Button disabled>disabled</Button>
        </Section>

        <Section title="Badges" file="components/ui/badge.tsx">
          {(["default", "secondary", "destructive", "outline", "chip", "ghost"] as const).map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
          {/* `chip` is the status shape wave 2 pushed onto the outcome pill,
              the form status and the accounts list: DESIGN.md rule 3 wants a
              7px dot beside the word, never the word in a coloured box. */}
          <Badge variant="chip" className="gap-1.5 py-1 pr-2.5 pl-2">
            <span className="size-[7px] rounded-full bg-[var(--good)]" aria-hidden />
            chip + dot
          </Badge>
        </Section>

        <section aria-labelledby="sg-activity-status" data-testid="styleguide-activity-status" className="space-y-3">
          <h2 id="sg-activity-status" className="text-sm font-medium">Activity status</h2>
          <div className="flex flex-wrap gap-2">
            {(["sent", "held", "skipped", "failed"] as const).map((s) => <LogStatusPill key={s} status={s} />)}
          </div>
          {/* The same DotPill (components/dot-pill.tsx), `dense`, as the
              calendar shows the customer's answer to the confirmation text:
              a yes in the history's `sent` colours, a NO as a warning because
              it is the one an operator must act on. Read off
              confirm-reply.ts's own map, so this row cannot drift. */}
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            components/dot-pill.tsx · …/calendar/confirm-reply.ts
          </p>
          <div className="flex flex-wrap gap-2" data-testid="styleguide-confirm-reply">
            {(["yes", "no"] as const).map((a) => <DotPill key={a} {...CONFIRM_REPLY_TREATMENTS[a]} dense />)}
          </div>
          {/* The contact Messages block's Texts row (consent chain PR-1 and
              PR-2): its four states, each a dot + word. Allowed, Stopped and
              On hold are read off lib/consent/texts-row.ts; Check number off
              lib/contacts/phone-country.ts, so none can drift. */}
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            …/contacts/texts-row.tsx · lib/consent/texts-row.ts · lib/contacts/phone-country.ts
          </p>
          <div className="flex flex-wrap items-center gap-2" data-testid="styleguide-texts-state">
            <span className="text-sm">{m["contact.messages.texts"]}</span>
            <DotPill {...TEXTS_TREATMENT.allowed} dense data-status="allowed" />
            <DotPill {...TEXTS_TREATMENT.stopped} dense data-status="stopped" />
            <DotPill {...TEXTS_TREATMENT.held} dense data-status="held" />
            <DotPill {...PHONE_CHECK_TREATMENT} dense data-status="unconfirmed_number" />
          </div>
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            …/contacts/email-row.tsx · lib/consent/email-row.ts
          </p>
          <div className="flex flex-wrap items-center gap-2" data-testid="styleguide-email-state">
            <span className="text-sm">{m["contact.messages.email"]}</span>
            <DotPill {...EMAIL_TREATMENT.allowed} dense data-status="allowed" />
            <DotPill {...EMAIL_TREATMENT.stopped} dense data-status="stopped" />
          </div>
        </section>

        <Section title={t(m, "styleguide.choiceTiles", "en")} file="components/choice-tiles.tsx">
          <ChoiceTilesDemo />
        </Section>

        {/* F-085 part 1 (spec §9): the "Assigned to" inline pick, editable and
            read-only, and the All · Mine · Unassigned row that sits in a list
            page's filter slot. Mine is current here; the links lead back to
            this page. */}
        <Section title={m["assign.field.label"]} file="components/assign/assignee-field.tsx">
          <AssignDemo />
        </Section>

        {/* Relationships spec §7: the Related people card on the drawer and the record, loaded
            (English and Spanish), empty, loading and error. */}
        <Section title={m["relationships.title"]} file="accounts/[accountId]/contacts/relationships-card.tsx">
          <RelationshipsDemo />
        </Section>

        {/* S-02 B2 §8: the Properties card on the drawer and the record, loaded (English, Spanish
            and a Technician's view, which has no Belongs to), empty, loading and error. */}
        <Section title={m["places.title"]} file="accounts/[accountId]/contacts/places-card.tsx">
          <PlacesDemo />
        </Section>

        {/* S-07 part 1 (spec 4): the Documents card on the record, loaded (English and Spanish), empty,
            loading, in error, and with its upload panel open mid-batch. */}
        <Section title={m["documents.title"]} file="accounts/[accountId]/contacts/documents-card.tsx">
          <DocumentsDemo />
        </Section>

        {/* S-07 3a (spec 3.1, 3.3): the account-wide Documents page's own cards — the Owner's
            Required documents card (partial in English and Spanish, off, and a failed read) and
            the list's rows. */}
        <Section title={t(m, "documents.page.title", "en")} file="accounts/[accountId]/documents/page.tsx">
          <DocumentsPageDemo />
        </Section>

        {/* S-06 part 1, Task 12: the inbox's "Needs a look" filter — two held
            items (one not on record, one unverified), empty and loading. */}
        <Section title={t(m, "conversations.held.title", "en")} file="accounts/[accountId]/conversations/held-email-list.tsx">
          <HeldEmailsDemo />
        </Section>

        {/* S-06 part 2: the Never record list — loaded (English and Spanish), empty, and a failed read. */}
        <Section title={t(m, "neverLog.title", "en")} file="components/never-log-list.tsx">
          <NeverLogDemo />
        </Section>

        {/* S-06 part 2: the record's Forwarding address row — the address with Copy (English and
            Spanish), the agency's turn-on line, the error, and none, which draws nothing. */}
        <Section title={t(m, "contact.forwarding.label", "en")} file="accounts/[accountId]/contacts/[contactId]/forwarding-address-row.tsx">
          <ForwardingDemo />
        </Section>

        {/* S-06 part 3: a lead's website chat on the thread (both marks, both languages, the unconfirmed line) and its one record row. */}
        <Section title={t(m, "conversations.channel.webchat", "en")} file="accounts/[accountId]/conversations/message-thread.tsx">
          <WebchatDemo />
        </Section>

        {/* S-03 part 1 (spec §15): the record kit: layout at both widths, header with all and no
            actions, a card loading, ready, empty, in error and closed on a phone. */}
        <Section title={t(m, "styleguide.recordKit", "en")} file="components/record/*">
          <RecordDemo />
        </Section>

        <Section title={m["assign.filter.label"]} file="components/assign/who-filter.tsx">
          <div className="flex flex-col gap-3" data-testid="styleguide-who-filter">
            <WhoFilter base="/dashboard/styleguide" current="mine" showMine params={{}} />
            {/* The agency is never a person of the company, so it has no Mine. */}
            <WhoFilter base="/dashboard/styleguide" current="all" showMine={false} params={{}} />
          </div>
        </Section>

        <Section title="Meter" file="components/meter.tsx">
          {/* The mockup's `.meter` (northern-lights.html:56): a 5px track on
              --meter-bg. The default fill is the CONTENT accent pair; a
              STATUS reading passes a flat fill, because status is never a
              gradient. */}
          <div className="flex w-full max-w-sm flex-col gap-3">
            <Meter percent={38} label="Calls used" max={100} now={38} valueText="38 of 100 calls" />
            <Meter
              percent={86}
              label="Calls used (near cap)"
              max={100}
              now={86}
              valueText="86 of 100 calls"
              fill="bg-[var(--warn)]"
            />
            <Meter
              percent={100}
              label="Setup progress (done)"
              max={6}
              now={6}
              valueText="6 of 6 steps"
              fill="bg-[var(--good)]"
            />
          </div>
        </Section>

        {/* Task 6 (Spanish-runtime lane), DESIGN.md DoD "English and
            Spanish": the sidebar's own labelKey → copy lookup now runs
            through LocaleProvider/useLocale()/t() (app-sidebar.tsx). One
            short label (Contacts/Contactos) and the longest nav.* label in
            either language (Phone numbers/Números de teléfono), so the one
            translation worth the sidebar's narrowest-width overflow check
            is visible here too. */}
        <Section title="Locale" file="components/locale-provider.tsx · lib/i18n/t.ts · components/app-sidebar.tsx">
          <div className="flex w-full flex-col gap-4">
            {NAV_LABEL_KEYS.map((key) => <LocaleNavDemo key={key} labelKey={key} />)}
            {/* Task 11's own third column: the pseudo-locale overflow check
                (e2e/i18n-overflow.spec.ts) runs against THIS page, not the
                live sidebar, because `[accountId]/layout.tsx` is a
                `layout.tsx` and can never receive `searchParams` — so
                `?locale=pseudo` can't reach the account layout's own
                `requestLocale` call. No LocaleProvider here: pseudo-locale
                is never a real catalogue lookup, just the English string run
                through `pseudoLocale()` directly. `data-nav-label="pseudo"`
                is a distinct VALUE from the en/es spans' boolean
                `data-nav-label` (which React renders as `"true"`), so the
                spec's `[data-nav-label='pseudo']` locator selects only this
                column.

                Fix round 1 (reviewer C1): rendered through the SAME
                `NavRowGeometry`/`NAV_LABEL_SPAN_CLASS` the real en/es
                columns use (locale-nav-demo.tsx), not a bare, unconstrained
                span — so a pseudo label genuinely CAN clip here, at the
                real sidebar's expanded width. `title` carries the full,
                un-truncated text: a clipped pseudo label is accepted
                truncation (the real sidebar's own `Link` tolerates it the
                same way, via its own unconditional `title`), so the spec
                asserts a clipped label still carries its full text in
                `title`, not that it never clips. */}
            {pseudo ? (
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  pseudo
                </span>
                <div className="flex flex-wrap gap-4">
                  {NAV_LABEL_KEYS.map((key) => {
                    const label = pseudoLocale(m[key]);
                    return (
                      <NavRowGeometry key={key}>
                        <span data-nav-label="pseudo" title={label} className={NAV_LABEL_SPAN_CLASS}>
                          {label}
                        </span>
                      </NavRowGeometry>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </Section>

        <Section title="Tag chips" file="components/tag-chips.tsx">
          <TagChips
            tags={[
              { id: "1", name: "vip" },
              { id: "2", name: "roofing" },
              { id: "3", name: "overflow" },
            ]}
          />
        </Section>

        {/* DESIGN.md rule 3: status is never colour alone — dot + word. All
            six rail kinds, read straight off the rail's own exported maps so
            this page can never drift from the wizard it documents. A client
            component because those maps live in a "use client" module — see
            rail-states.tsx for what that cost before it was one. */}
        <Section title="Status states (setup rail)" file="…/setup/setup-rail.tsx">
          <RailStates />
        </Section>

        {/* The one component on this page that does NOT belong to the
            dashboard: it renders on the public booking, cancel and lead-form
            pages, outside the Tailwind layer, which is why it brings its own
            stylesheet. Shown name-only — the styleguide has no tenant logo to
            borrow, and inventing one would misrepresent the component's own
            sizing. An account with a brand name but no upload renders exactly
            this. */}
        <Section title="Public brand header" file="components/public-brand.tsx">
          <div className="w-full">
            <PublicBrand name="Rio Roofing" logoUrl={null} />
          </div>
        </Section>

        <Section
          title="Website assistant — launcher & message bubbles"
          file="lib/forms/embed-script.ts (loader, served at app/embed.js/route.ts) · app/c/[publicId]/concierge-chat.tsx · concierge.css"
        >
          <div
            className="flex w-full flex-wrap items-start gap-8"
            // concierge.css's `.bis-msg-*` rules paint from `--form-accent`/
            // `--form-accent-foreground` — `publicFormTheme`'s own CTA pair,
            // set on the real `/c/[publicId]` page but never on a dashboard
            // route. Undefined here, `var(--form-accent, #6D28D9)` always
            // took its literal fallback — the mockup's violet, unmoved by
            // `.dark` — so the bubbles below looked identical in both
            // themes. Bridged to this dashboard's own accent pair instead
            // of inventing a third color, so the demo actually shows what a
            // themed tenant's visitor sees, in both modes.
            style={{
              "--form-accent": "var(--accent)",
              "--form-accent-foreground": "var(--primary-foreground)",
            } as React.CSSProperties}
          >
            {/* The launcher `embed.js` draws on the HOST page — inline-styled
                there on purpose (a snippet running on someone else's site
                cannot reach this app's CSS custom properties), so this is a
                tokened re-creation for reference, not the literal element. */}
            <div className="flex flex-col items-center gap-2">
              <div
                data-slot="concierge-launcher-demo"
                className="flex size-14 items-center justify-center rounded-full bg-[var(--accent)] text-2xl text-primary-foreground shadow-[var(--shadow-glow)]"
                aria-hidden
              >
                💬
              </div>
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Launcher</p>
            </div>
            <ol className="bis-concierge-log w-full max-w-xs list-none" aria-hidden>
              <li className="bis-msg bis-msg-assistant">Hi! Ask me anything about our services.</li>
              <li data-slot="concierge-bubble-demo" className="bis-msg bis-msg-visitor">Do you serve the 78041 zip code?</li>
              <li className="bis-msg bis-msg-assistant bis-msg-skeleton" aria-label="Thinking">
                <span /><span /><span />
              </li>
            </ol>
          </div>
        </Section>

        <Section title="Shared embed snippet card" file="components/embed-snippet.tsx">
          <div className="grid w-full max-w-sm gap-4">
            <EmbedSnippet
              attribute="data-concierge"
              publicId="pub_demo123"
              origin="https://app.example.com"
              title={m["voice.assistant.snippetTitle"]}
              hint={m["voice.assistant.snippetHint"]}
              disabledHint={m["voice.assistant.noFormBody"]}
              enabled
              copyLabel={m["voice.assistant.copy"]}
              copiedLabel={m["voice.assistant.copied"]}
              publicLinkLabel={m["voice.assistant.publicLink"]}
            />
            <EmbedSnippet
              attribute="data-concierge"
              publicId="pub_demo123"
              origin="https://app.example.com"
              title={m["voice.assistant.snippetTitle"]}
              hint={m["voice.assistant.snippetHint"]}
              disabledHint={m["voice.assistant.noFormBody"]}
              enabled={false}
              copyLabel={m["voice.assistant.copy"]}
              copiedLabel={m["voice.assistant.copied"]}
              publicLinkLabel={m["voice.assistant.publicLink"]}
            />
          </div>
        </Section>

        <Section title="Form controls" file="components/ui/{input,label,checkbox}.tsx">
          <div className="grid w-full max-w-sm gap-2">
            <Label htmlFor="sg-input">Label</Label>
            <Input id="sg-input" placeholder="Placeholder" />
            <Input id="sg-input-disabled" placeholder="Disabled" disabled />
            <Textarea id="sg-textarea" placeholder="A few lines of text" rows={3} />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox id="sg-check" /> Checkbox
            </label>
          </div>
        </Section>

        {/* The text a customer will receive, shown as the field it becomes:
            the one preview box every Automations card renders. The text is
            the text reminder's real default, built by its own composer and
            the send path's opt-out rule, so it is exactly what goes out. */}
        <Section title="SMS preview" file="components/sms-preview.tsx">
          <div className="grid w-full max-w-sm gap-1.5">
            <SmsPreview
              id="sg-sms-preview"
              label={m["automations.smsReminder.preview"]}
              text={withOptOut(composeSmsReminder(
                "Rio Roofing",
                formatWhen(SMS_REMINDER_PREVIEW_INSTANT, "America/Chicago"),
                defaultSmsReminderBody(),
              ))}
              testId="styleguide-sms-preview"
            />
          </div>
        </Section>

        {/* S-09 PR 2 Task 14: the Spanish box every editable automatic message shares, beside its
            English box on the card (Task 15 pins the pairing). Three of its four stored shapes:
            nothing stored (our Spanish, pre-filled), stale (the stored row no longer matches a
            changed English), and emptied (the stored row is the empty string, so Spanish customers
            get the English message). All through m[…] already — no new literal here. */}
        <Section title={m["automations.bodyEs.label"]} file="components/spanish-body-field.tsx">
          <SpanishBodyFieldDemo />
        </Section>

        <Section
          title="Settings field cards"
          file="…/settings/{sending-address,weekly-report}-card.tsx · components/alert-phone-card.tsx"
        >
          <SettingsFieldCards />
        </Section>

        <Section title="Table + row states" file="components/ui/table.tsx">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Resting row</TableCell>
                <TableCell><Badge variant="outline">Booked</Badge></TableCell>
              </TableRow>
              <TableRow data-state="selected">
                <TableCell>Selected row</TableCell>
                <TableCell><Badge variant="secondary">Lead</Badge></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Section>

        {/* DESIGN.md rule 3: status is never colour alone — dot + word. Read
            straight off screened-table.tsx's own `CLASS_DOT` map and the
            message catalogue's reason words, all six reasons across the
            three classes, so this page cannot drift from the real table. */}
        <Section title="Screened reasons" file="…/screened/screened-table.tsx">
          <div className="flex w-full flex-wrap gap-2">
            {SCREENED_REASONS.map((reason) => (
              <span
                key={reason}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs"
              >
                <span
                  className={cn("size-[7px] shrink-0 rounded-full", CLASS_DOT[screenedClass(reason)])}
                  aria-hidden
                />
                {m[`screened.reason.${reason}` as const]}
              </span>
            ))}
          </div>
        </Section>

        {/* Item 8b-1: the one suggestion card the call page and the To do tray show, in its five states
            (dot and word, rule 3) in English, Spanish and the pseudo-locale, with Edit and accept's form,
            and the section's error and loading states. Views come from the real builder, so this page
            cannot drift from the card. */}
        <Section title="Suggestion card" file="components/proposals/suggestion-{card,actions,section}.tsx">
          <div className="flex w-full flex-col gap-6">
            <SuggestionDemo columns={suggestionColumns()} />
            <div className="grid w-full gap-6 md:grid-cols-2">
              {(["en", "es"] as const).map((locale) => (
                <div key={locale} data-sg-suggestions-states={locale} className="flex min-w-0 max-w-[360px] flex-col gap-6">
                  <SuggestionSection tr={makeTr(locale)} personaName="Sofía" data={{ ok: false }} {...NO_SUGGESTION_ACTIONS} />
                  <SuggestionSectionSkeleton tr={makeTr(locale)} />
                  {/* The line under a capped stack, as the To do tray shows it past 200 (plan deviation 19). */}
                  <div data-sg-suggestions-cap={locale}><SuggestionCapLine tr={makeTr(locale)} /></div>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* Item 8b-2: the To do tray's cards grouped by customer then by call, "Waiting for you" on the
            record in its five states, and the agency Work page's per-account cards with their own cap
            line — English, Spanish and the pseudo-locale, built from the real `groupSuggestions` and
            `buildSuggestionView` over the same typed-out rows. */}
        <Section title="Work tray: grouped, Waiting for you, the agency section"
          file="components/proposals/{suggestion-row,suggestion-group,suggestion-section}.tsx · lib/proposals/group.ts">
          <WorkTrayDemo columns={buildWorkTrayColumns()} />
        </Section>

        <Section title="Loading skeletons" file="components/ui/skeleton.tsx">
          <div className="flex w-full max-w-sm flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </Section>

        <Section title="Stat tiles + website chart" file="components/stat-tile.tsx · …/website/{daily-chart,device-strip}.tsx">
          {/* F-107 (rider part): `min-w-0` on both — `Section`'s own
              `CardContent` (ui/card.tsx) is `flex flex-wrap`, and a flex
              item's automatic minimum size otherwise floors at its
              content's min-content width even with `w-full` set (a
              percentage width doesn't exempt it — only `min-width:0`
              does), which held this whole demo row open past the card at
              phone width. */}
          <div className="grid w-full min-w-0 gap-3 md:grid-cols-2">
            <StatTile hero label="Visitors" value="1,248" delta={{ direction: "up", label: "12%" }} spark={[3, 5, 4, 7, 9, 6, 8]} />
            <StatTile label="Pageviews" value="3,910" delta={{ direction: "flat", label: "0%" }} spark={[9, 8, 9, 10, 9, 8, 9]} />
            {/* I7: the Spanish variant — label through t(), and the worded
                delta (the sr-only sentence beside ▼) in Spanish too. `lang`
                on the wrapper, as the dashboard KPI row carries it. */}
            <div lang="es" className="min-w-0">
              <StatTile label={t(m, "dashboard.kpi.appointmentsBooked", "es")} value="12" delta={{ direction: "down", label: "3" }} spark={[4, 3, 5, 2, 3, 1, 2]} locale="es" />
            </div>
          </div>
          <div className="w-full min-w-0">
            <DailyChart
              days={[
                { day: "2026-08-31", visitors: 42, pageviews: 90, isWeekend: false }, { day: "2026-09-01", visitors: 55, pageviews: 120, isWeekend: false },
                { day: "2026-09-02", visitors: 48, pageviews: 101, isWeekend: false }, { day: "2026-09-03", visitors: 61, pageviews: 133, isWeekend: false },
                { day: "2026-09-04", visitors: 80, pageviews: 170, isWeekend: false }, { day: "2026-09-05", visitors: 30, pageviews: 61, isWeekend: true },
                { day: "2026-09-06", visitors: 26, pageviews: 50, isWeekend: true },
              ]}
              secondSeries={{ label: m["website.chart.series.pageviewsThird"], values: [30, 40, 34, 44, 57, 20, 17] }}
            />
          </div>
          {/* F-107 (rider part): `min-w-0` on this wrapper, not
              device-strip.tsx itself (…/website/** is outside this
              rider's ownership) — DeviceStrip's own root div is a direct
              flex-wrap item of `Section`'s CardContent (ui/card.tsx), and
              its three-item legend held that item open past the card at
              phone width. */}
          <div className="w-full min-w-0">
            <DeviceStrip devices={[{ name: "mobile", visitors: 71, share: 0.71 }, { name: "desktop", visitors: 26, share: 0.26 }, { name: "tablet", visitors: 3, share: 0.03 }]} />
          </div>
        </Section>

        <Section title="Zone note" file="components/zone-note.tsx">
          {/* All four states, because the interesting ones only appear on a
              MISCONFIGURED account and nobody would otherwise see them.
              DESIGN.md rule 3: every marker here is a word — strip the tint
              and each still says exactly what it means. */}
          <div className="w-full space-y-5">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Configured — the zone is simply named</p>
              <ZoneNote
                zone={{ zone: "America/Chicago", guessed: false, label: "America/Chicago", source: "account" }}
                isAgency
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Guessed from the agency — agency reader, told what&apos;s broken (no Settings link: there&apos;s nowhere to send it)</p>
              <ZoneNote
                zone={{ zone: "America/Chicago", guessed: true, label: "America/Chicago", source: "agency" }}
                isAgency
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Nothing usable anywhere — agency reader</p>
              <ZoneNote
                zone={{ zone: "UTC", guessed: true, label: "UTC", source: "fallback" }}
                isAgency
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Client reader — a person to ask, never a link; Settings is agency-only
              </p>
              <ZoneNote
                zone={{ zone: "UTC", guessed: true, label: "UTC", source: "fallback" }}
                isAgency={false}
              />
            </div>
          </div>
        </Section>

        <Section title="Line-down banner" file="components/line-down-banner.tsx">
          {/* DERIVED, never stored — see the component's own doc comment.
              The zero state renders NOTHING (a banner reading "0 numbers are
              turning callers away" is noise on the good day, which is most
              days), so there is no empty box to show here for it — only a
              caption saying so. DESIGN.md rule 3: the sentence itself is the
              marker, never the tint alone. */}
          <div className="w-full space-y-5">
            <p className="text-xs text-muted-foreground">
              Zero lines down renders nothing at all — no box, no caption on
              the real screen. The line below is the proof: it mounts
              <code className="font-mono">{"<LineDownBanner count={0} />"}</code>
              and nothing appears between this line and the next one.
            </p>
            <LineDownBanner count={0} />
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">One line down — singular phrase, not a plural template</p>
              <LineDownBanner count={1} />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Several — distinct numbers in the last 24 hours, not a lifetime total</p>
              <LineDownBanner count={3} />
            </div>
          </div>
        </Section>

        <Section title="Stale-usage banner" file="components/usage-stale-banner.tsx">
          {/* The line-down banner's design: derived, never stored, and the
              zero state renders NOTHING. DESIGN.md rule 3: the sentence is
              the marker, never the tint alone. */}
          <div className="w-full space-y-5">
            <p className="text-xs text-muted-foreground">
              Every billed client up to date renders nothing at all. The line below mounts
              <code className="font-mono">{"<UsageStaleBanner count={0} />"}</code>
              and nothing appears between this line and the next one.
            </p>
            <UsageStaleBanner count={0} />
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">One client — singular phrase, not a plural template</p>
              <UsageStaleBanner count={1} />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Several — billed clients whose usage has waited over a day</p>
              <UsageStaleBanner count={3} />
            </div>
          </div>
        </Section>

        <Section title="Billing status and banner" file="lib/billing/billing-view.ts · components/billing-banner.tsx">
          {/* DESIGN rule 3: every billing state is a dot AND a word, in token
              classes only (billing-view.test.ts pins them). The banner is the
              payment-failed one, in both audiences' words. */}
          <div className="w-full space-y-5">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(BILLING_STATUS_TREATMENTS) as BillingStatus[]).map((s) => (
                <DotPill key={s} label={BILLING_STATUS_TREATMENTS[s].label} chip={BILLING_STATUS_TREATMENTS[s].chip}
                  dot={BILLING_STATUS_TREATMENTS[s].dot} data-status={s} />
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">The client, on every page of their account</p>
              <BillingBanner audience="client" accountId="styleguide" />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">The agency, inside that account</p>
              <BillingBanner audience="agency" accountId="styleguide" />
            </div>
          </div>
        </Section>

        <Section title="Manage billing" file="…/accounts/[accountId]/billing/manage-billing-button.tsx">
          {/* The client Billing page's one primary (DESIGN rule 8). Pressing it
              here shows its failure state: the sentence, said inline. Beside
              it, the one status word only the Billing PAGE uses: a first
              payment still going through, in the client's words to whoever
              opens the page (the agency's Settings card says Payment failed). */}
          <div className="w-full space-y-4">
            <DotPill {...PAYMENT_PROCESSING} data-status="payment_processing" />
            <ManageBillingButton open={styleguidePortalFailed} help={m["billing.page.manageHelp"]} />
          </div>
        </Section>

        <Section title="Billing card (agency, on account Settings)" file="accounts/[accountId]/settings/billing-card.tsx">
          {/* Every status word, the no-plans and no-Stripe lines, and the
              loading and error states. One primary per card (rule 8): Send
              billing link, where it applies. Built by the real
              billingCardView from fixture rows (billing-card-states.tsx). */}
          <BillingCardStates />
        </Section>

        <Section title="Settings cards that stream (loading)" file="accounts/[accountId]/settings/page.tsx">
          {/* The two Settings cards that wait on a third party (Clerk's member
              list, Vercel's project list) stream in their own Suspense, and
              these are what shows until they land. Real titles, bars for
              what is still coming, and each keeps its card's anchor id so a
              palette jump still lands on it. */}
          <div className="flex w-full flex-wrap items-start gap-6">
            <div className="w-full max-w-md"><ClientAccessSkeleton /></div>
            <div className="w-full max-w-md"><LinkSiteSkeleton linkedDomain={null} /></div>
          </div>
        </Section>

        <Section title="Empty state" file="components/empty-state.tsx">
          <div className="w-full">
            <EmptyState
              icon={Inbox}
              title="No conversations yet"
              body="When someone replies to a form or a call, the thread shows up here."
              action={<Button size="sm">Send a message</Button>}
            />
          </div>
        </Section>

        <Separator />
        <p className="max-w-prose text-xs text-muted-foreground">
          Interactive components with their own state — the contact drawer
          (…/contacts/contact-drawer.tsx), InlineField
          (components/inline-field.tsx), the bulk-action bar
          (…/contacts/bulk-action-bar.tsx), the command palette
          (components/command-palette.tsx) and toasts (components/ui/sonner.tsx)
          — are exercised on their own screens and in the e2e suite rather than
          re-mounted here with invented data that could drift from the real
          thing.
        </p>
      </div>
    </>
  );
}
