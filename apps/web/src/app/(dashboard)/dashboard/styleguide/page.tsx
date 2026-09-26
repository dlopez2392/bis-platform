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
import { SCREENED_REASONS, screenedClass, type ProposalStatus } from "@bis/db";
import { CLASS_DOT } from "../screened/screened-table";
import { STATUS_TREATMENT } from "../accounts/[accountId]/calls/[callId]/proposals";
import { LogStatusPill } from "../accounts/[accountId]/activity/log-status-pill";
import { CONFIRM_REPLY_TREATMENTS } from "../accounts/[accountId]/calendar/confirm-reply";
import { DotPill } from "@/components/dot-pill";
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
import { SettingsFieldCards } from "./settings-field-cards";
import { BillingCardStates } from "./billing-card-states";
import { PublicBrand } from "@/components/public-brand";
import "@/styles/public-brand.css";
import { EmbedSnippet } from "@/components/embed-snippet";
import "@/app/c/[publicId]/concierge.css";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

/** All three of `STATUS_TREATMENT`'s own keys, in the order a reader meets
 *  them: still open, then the two decided outcomes. */
const PROPOSAL_STATUSES: ProposalStatus[] = ["pending", "accepted", "dismissed"];

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
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {file}
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-start gap-3">{children}</CardContent>
    </Card>
  );
}

export default async function StyleguidePage() {
  await requireAgency();

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
        </section>

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

        {/* DESIGN.md rule 3 again, for the call-detail proposals block's own
            vocabulary (Suggested / Accepted / Dismissed) — Call Proposals
            Task 7. Read straight off `proposals.tsx`'s own `STATUS_TREATMENT`
            map, same precedent as "Screened reasons" above, so this page
            cannot drift from the real block. */}
        <Section title="Proposal status" file="…/calls/[callId]/proposals.tsx">
          <div className="flex w-full flex-wrap gap-2">
            {PROPOSAL_STATUSES.map((status) => {
              const treatment = STATUS_TREATMENT[status];
              return (
                <span
                  key={status}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs"
                >
                  <span
                    className={cn("size-[7px] shrink-0 rounded-full", treatment.dot)}
                    aria-hidden
                  />
                  {m[treatment.labelKey]}
                </span>
              );
            })}
          </div>
        </Section>

        {/* Fix-wave Important 1 (task-11-brief): the due-date caption a
            `task` proposal shows on its review card, on both the call-detail
            page and the two work-queue screens (agency + account) — the half
            of the fix a reader accepts on sight, alongside `generate.ts`'s
            own forward-window rejection of a due date that could never be
            real. */}
        <Section title="Proposal due date" file="…/calls/[callId]/proposals.tsx">
          <div className="flex flex-col gap-1">
            <p className="text-sm leading-6 text-foreground">
              {m["proposals.task.label"].replace("{title}", () => "Call back about the quote")}
            </p>
            <p className="text-xs text-muted-foreground">
              {m["proposals.task.due"].replace("{date}", () => "Sep 23, 2026")}
            </p>
          </div>
        </Section>

        <Section title="Loading skeletons" file="components/ui/skeleton.tsx">
          <div className="flex w-full max-w-sm flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </Section>

        <Section title="Stat tiles + website chart" file="components/stat-tile.tsx · …/website/{daily-chart,device-strip}.tsx">
          <div className="grid w-full gap-3 md:grid-cols-2">
            <StatTile hero label="Visitors" value="1,248" delta={{ direction: "up", label: "12%" }} spark={[3, 5, 4, 7, 9, 6, 8]} />
            <StatTile label="Pageviews" value="3,910" delta={{ direction: "flat", label: "0%" }} spark={[9, 8, 9, 10, 9, 8, 9]} />
          </div>
          <div className="w-full">
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
          <DeviceStrip devices={[{ name: "mobile", visitors: 71, share: 0.71 }, { name: "desktop", visitors: 26, share: 0.26 }, { name: "tablet", visitors: 3, share: 0.03 }]} />
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
                accountId="demo"
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Guessed from the agency — agency reader, gets the fix</p>
              <ZoneNote
                zone={{ zone: "America/Chicago", guessed: true, label: "America/Chicago", source: "agency" }}
                isAgency
                accountId="demo"
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Nothing usable anywhere — agency reader</p>
              <ZoneNote
                zone={{ zone: "UTC", guessed: true, label: "UTC", source: "fallback" }}
                isAgency
                accountId="demo"
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Client reader — no Settings link, because that route is agency-only
              </p>
              <ZoneNote
                zone={{ zone: "UTC", guessed: true, label: "UTC", source: "fallback" }}
                isAgency={false}
                accountId="demo"
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
