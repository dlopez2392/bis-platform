"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DotPill } from "@/components/dot-pill";
import { Button } from "@/components/ui/button";
import { ListPanel, LIST_ROW } from "@/components/ui/list-panel";
import { PLAN_STATUS_TREATMENTS, type PlanRowView } from "@/lib/billing/plan-rows";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import type { PlanActionResult } from "./actions";
import { PlanDialog } from "./plan-dialog";

type Props = {
  rows: PlanRowView[];
  /** False while Stripe is not connected: an edit could not be saved. */
  canEdit: boolean;
  update: (planId: string, expectedUpdatedAt: string, formData: FormData) => Promise<PlanActionResult>;
  archive: (planId: string) => Promise<PlanActionResult>;
  restore: (planId: string) => Promise<PlanActionResult>;
};

export function PlansList({ rows, ...actions }: Props) {
  return (
    <ListPanel as="ul" aria-label={m["plans.title"]}>
      {rows.map((row) => <PlanRow key={row.id} row={row} {...actions} />)}
    </ListPanel>
  );
}

function PlanRow({ row, canEdit, update, archive, restore }: Omit<Props, "rows"> & { row: PlanRowView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const treatment = PLAN_STATUS_TREATMENTS[row.status];
  const name = row.plan.name;

  /** Reversible → immediate + undo toast (DESIGN.md rule 6). The undo runs
   *  inside the same transition, so the row's buttons stay disabled for it.
   *  A THROWN action (a dropped network request) is caught here rather than
   *  left to escape `startTransition`: an async transition that rejects
   *  reaches the nearest error boundary, and a network drop is not a crash —
   *  it gets the same `common.actionCrashed` toast the dialog's Save uses. */
  function run(first: (id: string) => Promise<PlanActionResult>, undo: (id: string) => Promise<PlanActionResult>, message: string) {
    startTransition(async () => {
      let result: PlanActionResult;
      try {
        result = await first(row.id);
      } catch {
        toast.error(m["common.actionCrashed"]);
        return;
      }
      if (!result.ok) { toast.error(result.error); return; }
      router.refresh();
      toast.success(message, {
        action: {
          label: m["common.undo"],
          onClick: () => startTransition(async () => {
            let back: PlanActionResult;
            try {
              back = await undo(row.id);
            } catch {
              toast.error(m["common.actionCrashed"]);
              return;
            }
            if (!back.ok) toast.error(back.error);
            else router.refresh();
          }),
        },
      });
    });
  }

  return (
    <li data-plan-row={row.id} className={cn("flex flex-wrap items-start gap-x-6 gap-y-3 px-4 py-3", LIST_ROW)}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-card-foreground">{name}</span>
          <DotPill label={treatment.label} chip={treatment.chip} dot={treatment.dot} dense data-status={row.status} />
        </div>
        <p className="text-sm tabular-nums text-card-foreground">{row.price}</p>
        <p className="text-xs tabular-nums text-muted-foreground">{row.allowances}</p>
        <p className="text-xs tabular-nums text-muted-foreground">{row.overage}</p>
        <p className="text-xs text-muted-foreground">{row.features} · {row.clients}</p>
      </div>
      <div className="flex items-center gap-1">
        {row.status === "active" && canEdit ? (
          <PlanDialog
            title={m["plans.dialog.editTitle"].replace("{name}", name)}
            plan={row.plan}
            trigger={
              <Button variant="ghost" size="sm" aria-label={m["plans.editLabel"].replace("{name}", name)}>
                {m["plans.edit"]}
              </Button>
            }
            // The version goes to the action EXACTLY as the database gave it
            // (microseconds and all). Never through Date: a truncated copy
            // matches no stored row, so the plan would read as stale forever.
            onSave={(formData) => update(row.id, row.plan.updatedAt, formData)}
          />
        ) : null}
        {row.status === "active" ? (
          <Button
            variant="ghost" size="sm" disabled={pending}
            aria-label={m["plans.archiveLabel"].replace("{name}", name)}
            onClick={() => run(archive, restore, m["plans.archived.toast"].replace("{name}", name))}
          >
            {m["plans.archive"]}
          </Button>
        ) : (
          <Button
            variant="ghost" size="sm" disabled={pending}
            aria-label={m["plans.restoreLabel"].replace("{name}", name)}
            onClick={() => run(restore, archive, m["plans.restored.toast"].replace("{name}", name))}
          >
            {m["plans.restore"]}
          </Button>
        )}
      </div>
    </li>
  );
}
