"use client";

import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DotPill } from "@/components/dot-pill";
import { m } from "@/lib/messages";

// At most ONE primary per card (DESIGN.md rule 8): while access is off the
// only thing this card can do is turn it on, so that is the primary; while it
// is on, "Turn off" is ghost, and the work (inviting) is the Team card's own
// primary under this one (staff and roles, Task 10).
function AccessButton({ primary, children }: { primary: boolean; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={primary ? "default" : "ghost"} disabled={pending}>
      {pending ? m["common.saving"] : children}
    </Button>
  );
}

const ACCESS_STATUS = {
  on: { label: m["clientAccess.statusOn"], dot: "bg-success", chip: "border-success/30 bg-success/10 text-foreground" },
  off: { label: m["clientAccess.statusOff"], dot: "bg-muted-foreground/60", chip: "border-border bg-transparent text-muted-foreground" },
} as const;

/**
 * The on/off switch (D-002). Says the current state as a dot AND a word
 * (rule 3), and flips at once with an Undo toast (rule 6): switching access
 * is reversible, so it is never a confirm dialog and never a silent one-way
 * write. Holds no React state, so a test can call it and reach its form
 * action without a DOM.
 */
export function ClientAccessSwitch({
  enabled,
  setAccessAction,
}: {
  enabled: boolean;
  setAccessAction: (formData: FormData) => Promise<void>;
}) {
  const flip = async (to: boolean, offerUndo: boolean): Promise<void> => {
    const formData = new FormData();
    formData.set("enabled", to ? "true" : "false");
    try {
      await setAccessAction(formData);
    } catch {
      toast.error(m["common.actionCrashed"]);
      return;
    }
    toast.success(
      to ? m["clientAccess.turnedOn"] : m["clientAccess.turnedOff"],
      offerUndo
        ? { action: { label: m["common.undo"], onClick: () => void flip(!to, false) } }
        : undefined,
    );
  };
  const status = enabled ? ACCESS_STATUS.on : ACCESS_STATUS.off;
  return (
    <form action={() => flip(!enabled, true)} className="flex flex-wrap items-center gap-3">
      <DotPill label={status.label} dot={status.dot} chip={status.chip} data-status={enabled ? "on" : "off"} />
      <AccessButton primary={!enabled}>
        {enabled ? m["clientAccess.disable"] : m["clientAccess.enable"]}
      </AccessButton>
    </form>
  );
}

/**
 * The Client access card: the on/off switch alone. Staff and roles (Task 10)
 * moved the member list and the invite to the Team card, which
 * ClientAccessSection renders under this one while access is on.
 */
export function ClientAccessPanel({
  enabled,
  setAccessAction,
}: {
  enabled: boolean;
  setAccessAction: (formData: FormData) => Promise<void>;
}) {
  return (
    // The palette's `settings:client-access` entry jumps here. scroll-mt-24
    // keeps the anchored section clear of the sticky topbar instead of
    // landing underneath it. The id lives on the component's own root so it
    // travels with the component rather than depending on its call site.
    <Card id="client-access" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{m["clientAccess.title"]}</CardTitle>
        <CardDescription>{m["clientAccess.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <ClientAccessSwitch enabled={enabled} setAccessAction={setAccessAction} />
      </CardContent>
    </Card>
  );
}

/**
 * Shaped like the loaded card (DESIGN.md rule 7, no spinners): the status
 * pill and its button (ClientAccessSwitch). The title and description are
 * static copy, so they are real text, not bars. The Team card under it has
 * its own skeleton (components/team/team-card.tsx).
 *
 * It carries the card's `id="client-access"` because the hash scroll runs
 * ONCE, when the page first commits, which is while this is showing. Without
 * the id the palette's "Client access" jump would find no target and land at
 * the top (next/dist/client/components/layout-router.js treats a missing
 * target as handled). BillingCardSkeleton keeps `id="billing"` for the same
 * reason.
 */
export function ClientAccessSkeleton() {
  return (
    <Card id="client-access" className="scroll-mt-24" aria-busy="true" aria-label={m["clientAccess.title"]}>
      <CardHeader>
        <CardTitle>{m["clientAccess.title"]}</CardTitle>
        <CardDescription>{m["clientAccess.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-9 w-36" />
        </div>
      </CardContent>
    </Card>
  );
}
