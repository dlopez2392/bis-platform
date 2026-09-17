"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, PhoneForwarded, PhoneOff, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { PhoneNumberStatus } from "@bis/db";
import { Button } from "@/components/ui/button";
import { ListPanel, LIST_ROW } from "@/components/ui/list-panel";
import { Notice } from "@/components/ui/notice";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { requiresMoveConfirm } from "@/lib/setup/setup-view";
import { NUMBER_STATUS_DOT, NUMBER_STATUS_LABEL } from "@/lib/voice/number-status";
import type { InventoryRow } from "@/lib/voice/number-inventory";
import { canRepairRouting, type RoutingStatus } from "@/lib/voice/number-routing";
import {
  moveNumberToAccountAction, releaseNumberAction, repairNumberRoutingAction,
} from "./actions";

/** Copy and dot per routing verdict. "Routed here" is the ONLY state in which
 *  a caller dialling this number reaches the company on its row — the rest
 *  are degrees of "the call goes somewhere else". `unchecked` is deliberately
 *  neutral, never a warning: it means we could not ask. */
const ROUTING: Record<RoutingStatus, { label: string; dot: string }> = {
  routed: { label: m["numbers.routing.routed"], dot: "bg-success" },
  elsewhere: { label: m["numbers.routing.elsewhere"], dot: "bg-destructive" },
  unrouted: { label: m["numbers.routing.unrouted"], dot: "bg-warning" },
  absent: { label: m["numbers.routing.absent"], dot: "bg-warning" },
  unchecked: { label: m["numbers.routing.unchecked"], dot: "border border-muted-foreground/60 bg-transparent" },
};

/**
 * Every number the platform holds, one row each, with the two writes an
 * operator actually needs: move it to another company, or stop it answering.
 *
 * Both writes re-establish everything server-side (./actions.ts) — the ids
 * below are a convenience, never a grant. What this component owns is that
 * the operator can SEE what they are about to do before they do it: whose
 * line it is, what it is currently doing, and — for a number that is
 * answering real callers right now — a confirm step that names the
 * consequence rather than asking "are you sure?".
 */
export function NumbersTable({
  rows, routing,
}: {
  rows: InventoryRow[];
  /** Carrier verdict per row id. A missing entry means the carrier was never
   *  asked (unconfigured, or the lookup failed) and reads as `unchecked`. */
  routing: Record<string, RoutingStatus>;
}) {
  return (
    <ListPanel as="ul">
      {rows.map((row) => (
        <li key={row.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3", LIST_ROW)}>
          <div className="min-w-0 flex-1">
            {/* Monospaced and selectable: this value gets read down a phone
                line and typed into a carrier portal, the same reasoning as
                the setup wizard's own NumberChip. */}
            <code className="font-mono text-[13px] font-medium text-card-foreground tabular-nums">
              {row.e164}
            </code>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {m["numbers.on"].replace("{account}", row.accountName ?? m["numbers.unknownAccount"])}
              {" · "}
              {row.telnyxId ?? m["numbers.noCarrierId"]}
            </p>
          </div>
          <StatusChip status={row.status} />
          <RoutingChip status={routing[row.id] ?? "unchecked"} />
          <RowActions row={row} routing={routing[row.id] ?? "unchecked"} />
        </li>
      ))}
    </ListPanel>
  );
}

/** DESIGN.md rule 3: dot AND word, never colour alone. */
function StatusChip({ status }: { status: PhoneNumberStatus }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("size-1.5 shrink-0 rounded-full", NUMBER_STATUS_DOT[status])} aria-hidden />
      {NUMBER_STATUS_LABEL[status]}
    </span>
  );
}

/** The carrier verdict, dot AND word like every other status in this app
 *  (DESIGN.md rule 3). */
function RoutingChip({ status }: { status: RoutingStatus }) {
  const tone = ROUTING[status];
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} aria-hidden />
      {tone.label}
    </span>
  );
}

type Mode = "idle" | "picking" | "moveConfirm" | "releaseConfirm";

/**
 * One row's controls, as a four-state machine rather than a dialog.
 *
 * `window.confirm` is banned in this codebase's browser tooling and a modal
 * would be the wrong shape anyway — the confirm needs the row's own context
 * (whose line, which company it is going to) beside it, which is exactly
 * what a modal takes away. Same inline two-step the setup wizard's move
 * button uses, for the same reason, and the destructive button names the
 * consequence: "stop answering", not "confirm".
 *
 * Only `testing` and `live` numbers get that step. Those two are the
 * statuses the incoming route accepts a call for, so they are the ones where
 * a move or a release takes a paying client's line down mid-day;
 * `provisioned` and `released` answer nobody either way and a plain click is
 * enough (`requiresMoveConfirm`, lib/setup/setup-view.ts, which carries the
 * decision so it has a test of its own).
 */
function RowActions({ row, routing }: { row: InventoryRow; routing: RoutingStatus }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [destination, setDestination] = useState<string>(row.moveTargets[0]?.id ?? "");
  // Not `useFormStatus`: Cancel sits outside the submitting control in every
  // branch below, so it could stay clickable through the whole round trip
  // and fire a second concurrent write for the same number — the exact fault
  // SetupMoveNumberButton documents.
  const [pending, setPending] = useState(false);

  const destinationName =
    row.moveTargets.find((a) => a.id === destination)?.name ?? null;
  const holder = row.accountName ?? m["numbers.unknownAccount"];

  async function run(work: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    setPending(true);
    try {
      const result = await work();
      if (!result.ok) {
        toast.error(result.error);
        setMode("idle");
        return;
      }
      toast.success(success);
      // Nothing is patched locally: the move changes this row's holder AND
      // every other row's move targets (the destination is now occupied, the
      // source may now be free), so the whole list is re-derived server-side.
      setMode("idle");
      router.refresh();
    } catch {
      // A stale deployment rejects the action outright. Without this the
      // failure would be silent on the one control that takes a live phone
      // line out of service.
      toast.error(m["common.actionCrashed"]);
      setMode("idle");
    } finally {
      setPending(false);
    }
  }

  const doMove = () =>
    run(
      () => moveNumberToAccountAction(row.id, destination),
      m["numbers.moved"]
        .replace("{e164}", row.e164)
        .replace("{account}", destinationName ?? m["numbers.unknownAccount"]),
    );

  const doRelease = () =>
    run(
      () => releaseNumberAction(row.id),
      m["numbers.released"].replace("{e164}", row.e164),
    );

  const doRepair = () =>
    run(
      () => repairNumberRoutingAction(row.id),
      m["numbers.routing.repaired"].replace("{e164}", row.e164),
    );

  if (mode === "moveConfirm") {
    return (
      <ConfirmRow
        warning={m["setup.number.moveConfirmWarning"].replace("{account}", holder)}
        label={m["setup.number.moveConfirm"].replace("{e164}", row.e164)}
        pending={pending}
        pendingLabel={m["setup.number.moving"]}
        onConfirm={doMove}
        onCancel={() => setMode("picking")}
      />
    );
  }

  if (mode === "releaseConfirm") {
    return (
      <ConfirmRow
        warning={m["numbers.releaseWarning"].replace("{account}", holder)}
        label={m["numbers.releaseConfirm"].replace("{e164}", row.e164)}
        pending={pending}
        pendingLabel={m["setup.number.moving"]}
        onConfirm={doRelease}
        onCancel={() => setMode("idle")}
      />
    );
  }

  if (mode === "picking") {
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Select value={destination} onValueChange={setDestination} disabled={pending}>
          <SelectTrigger
            className="w-48"
            aria-label={m["numbers.moveToLabel"].replace("{e164}", row.e164)}
          >
            <SelectValue placeholder={m["numbers.moveTo"]} />
          </SelectTrigger>
          <SelectContent>
            {row.moveTargets.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          // `destinationName` rather than `destination`: a selection that is
          // no longer among this row's targets resolves to null, and the
          // button must not offer to move a number somewhere the screen can
          // no longer name.
          disabled={pending || !destinationName}
          onClick={() => {
            if (requiresMoveConfirm(row.status)) setMode("moveConfirm");
            else void doMove();
          }}
        >
          {pending ? m["setup.number.moving"] : m["numbers.moveSubmit"]}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setMode("idle")}>
          {m["common.cancel"]}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {row.moveTargets.length === 0 ? (
        // Never a disabled button with no explanation: the reason this number
        // cannot move is a fact about the OTHER companies, which the operator
        // has no way to infer from a greyed-out control.
        <span className="text-xs text-muted-foreground">{m["numbers.moveNone"]}</span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            // Re-seed from the CURRENT targets every time the picker opens.
            // A destination chosen, cancelled, and then invalidated by a
            // refresh (another tab moved a number onto it) would otherwise
            // still be in state — the server refuses it, but the operator
            // would have been shown a picker with no selection and a live
            // Move button.
            setDestination(row.moveTargets[0]?.id ?? "");
            setMode("picking");
          }}
          aria-label={m["numbers.moveLabel"].replace("{e164}", row.e164)}
        >
          <ArrowLeftRight aria-hidden />
          {m["numbers.move"]}
        </Button>
      )}
      {/* Only where a PATCH would actually fix something. `canRepairRouting`
          withholds it for a number that is already correct, one Telnyx does
          not have (nothing to address), and one we could not inspect — a
          button that can only fail, or that writes against a verdict we never
          formed, is worse than none. */}
      {canRepairRouting(routing) ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void doRepair()}
          aria-label={m["numbers.routing.repairLabel"].replace("{e164}", row.e164)}
        >
          {pending ? null : <PhoneForwarded aria-hidden />}
          {pending ? m["numbers.routing.repairing"] : m["numbers.routing.repair"]}
        </Button>
      ) : null}
      {row.status === "released" ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (requiresMoveConfirm(row.status)) setMode("releaseConfirm");
            else void doRelease();
          }}
          aria-label={m["numbers.releaseLabel"].replace("{e164}", row.e164)}
        >
          <PhoneOff aria-hidden />
          {m["numbers.release"]}
        </Button>
      )}
    </div>
  );
}

/** The shared confirm step: the consequence in words, then a destructive
 *  button named for it, then a way out. `basis-full` puts the warning on its
 *  own line so it is read before the button rather than beside it. */
function ConfirmRow({
  warning, label, pending, pendingLabel, onConfirm, onCancel,
}: {
  warning: string;
  label: string;
  pending: boolean;
  pendingLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Notice tone="crit" className="w-full basis-full text-foreground">
        {warning}
      </Notice>
      <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={onConfirm}>
        {pending ? null : <TriangleAlert aria-hidden />}
        {pending ? pendingLabel : label}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
        {m["common.cancel"]}
      </Button>
    </div>
  );
}
