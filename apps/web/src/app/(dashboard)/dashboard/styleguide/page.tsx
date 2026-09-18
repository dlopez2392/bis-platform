import { Inbox } from "lucide-react";
import { requireAgency } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { Meter } from "@/components/meter";
import { DailyChart } from "../accounts/[accountId]/website/daily-chart";
import { DeviceStrip } from "../accounts/[accountId]/website/device-strip";
import { EmptyState } from "@/components/empty-state";
import { ZoneNote } from "@/components/zone-note";
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
import { cn } from "@/lib/utils";
import { RailStates } from "./rail-states";
import { SettingsFieldCards } from "./settings-field-cards";
import { PublicBrand } from "@/components/public-brand";
import "@/styles/public-brand.css";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

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
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
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
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t}</span>
              </div>
            ))}
            <div className="flex flex-col gap-1">
              <div className="h-14 w-28 rounded-lg" style={{ backgroundColor: "var(--accent-2)" }} />
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">--accent-2</span>
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
