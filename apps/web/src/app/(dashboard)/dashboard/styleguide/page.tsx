import { Inbox } from "lucide-react";
import { requireAgency } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { TagChips } from "@/components/tag-chips";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  STATE_LABEL, STATE_TONE,
} from "@/app/(dashboard)/dashboard/accounts/[accountId]/setup/setup-rail";
import type { RailKind } from "@/lib/setup/setup-rail";
import { cn } from "@/lib/utils";
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
const RAIL_KINDS: RailKind[] = ["done", "open", "next", "skipped", "unknown", "locked"];

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
            this page can never drift from the wizard it documents. */}
        <Section title="Status states (setup rail)" file="…/setup/setup-rail.tsx">
          {RAIL_KINDS.map((kind) => (
            <span
              key={kind}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs",
                STATE_TONE[kind].chip,
              )}
            >
              <span className={cn("size-1.5 rounded-full", STATE_TONE[kind].dot)} aria-hidden />
              {STATE_LABEL[kind]}
            </span>
          ))}
        </Section>

        <Section title="Form controls" file="components/ui/{input,label,checkbox}.tsx">
          <div className="grid w-full max-w-sm gap-2">
            <Label htmlFor="sg-input">Label</Label>
            <Input id="sg-input" placeholder="Placeholder" />
            <Input id="sg-input-disabled" placeholder="Disabled" disabled />
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
