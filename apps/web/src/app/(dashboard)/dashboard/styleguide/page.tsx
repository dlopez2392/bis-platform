import { Inbox } from "lucide-react";
import { requireAgency } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { DailyChart } from "../accounts/[accountId]/website/daily-chart";
import { DeviceStrip } from "../accounts/[accountId]/website/device-strip";
import { EmptyState } from "@/components/empty-state";
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
import { RailStates } from "./rail-states";
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
          {(["default", "secondary", "destructive", "outline", "ghost"] as const).map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
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

        <Section title="Loading skeletons" file="components/ui/skeleton.tsx">
          <div className="flex w-full max-w-sm flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </Section>

        <Section title="Website chart + device strip" file="…/website/{daily-chart,device-strip}.tsx">
          <DailyChart days={[
            { day: "2026-08-31", visitors: 42, pageviews: 90, isWeekend: false }, { day: "2026-09-01", visitors: 55, pageviews: 120, isWeekend: false },
            { day: "2026-09-02", visitors: 48, pageviews: 101, isWeekend: false }, { day: "2026-09-03", visitors: 61, pageviews: 133, isWeekend: false },
            { day: "2026-09-04", visitors: 80, pageviews: 170, isWeekend: false }, { day: "2026-09-05", visitors: 30, pageviews: 61, isWeekend: true },
            { day: "2026-09-06", visitors: 26, pageviews: 50, isWeekend: true },
          ]} />
          <DeviceStrip devices={[{ name: "mobile", visitors: 71, share: 0.71 }, { name: "desktop", visitors: 26, share: 0.26 }, { name: "tablet", visitors: 3, share: 0.03 }]} />
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
