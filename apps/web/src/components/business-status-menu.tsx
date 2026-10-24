"use client";

// S-47d Task 11 (plan "The topbar forms", spec §5.6.1): the one switch's own menu, mounted by BOTH the
// topbar indicator (its dot+words become the trigger) and the dashboard card (a plain "Change" button
// becomes the trigger) — `trigger` is the caller's own visible content, so this file draws the content
// once and never twice. DESIGN.md rule 6 (reversible, immediate, Undo toast) and rule 3 (dot+word, drawn
// by the CALLER, never here) both apply.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { MessageKey } from "@/lib/messages";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { useShellData } from "@/components/shell-data";
import type { ShellBusinessStatus } from "@/app/(dashboard)/dashboard/accounts/[accountId]/shell-actions";
import { setBusinessStatusAction, undoBusinessStatusAction, type UndoToken } from "@/app/(dashboard)/dashboard/accounts/[accountId]/business-status-actions";
import {
  addDays, dayKey, fromWire, type EffectiveStatus, type LateMinutes, type StatusChange, type StoredState,
} from "@/lib/business-status/status";

const UNDO_WINDOW_MS = 10_000;

const LATE_OPTIONS: readonly { value: LateMinutes; key: MessageKey }[] = [
  { value: 15, key: "business.menu.late15" },
  { value: 30, key: "business.menu.late30" },
  { value: 60, key: "business.menu.late60" },
  { value: 120, key: "business.menu.late120" },
];

/**
 * What the menu shows, derived purely from `canChange` and the effective state — no React, no Radix.
 * Radix's own `DropdownMenuContent`/`DropdownMenuSub` mount their items only while actually OPEN
 * (`Presence`'s `present = forceMount || context.open`, verified against
 * `@radix-ui/react-menu@2.1.24`'s own source), so a static server render of the CLOSED menu can never
 * show the open content — this is the seam that IS testable without one, and the one source of truth
 * both the component below and its test read.
 */
export type MenuPlan = { kind: "none" } | { kind: "late_only" } | { kind: "all"; openRow: "open" | "link" };

export function planMenu(status: ShellBusinessStatus): MenuPlan {
  if (status.canChange === null) return { kind: "none" };
  if (status.canChange === "late_only") return { kind: "late_only" };
  const effective = fromWire(status.effective);
  return { kind: "all", openRow: effective.state === "closed_day" ? "link" : "open" };
}

/** The radio group's checked value (open/closed_today/running_late/storm) — a closed day checks
 *  "closed_today" (spec: "a closed day reads the same as Closed today"), since the switch itself has
 *  no fifth value for it. */
function radioValue(effective: EffectiveStatus): StoredState {
  return effective.state === "closed_day" ? "closed_today" : effective.state;
}

const STATE_TOAST_KEY: Record<StoredState, MessageKey> = {
  open: "business.toast.open",
  closed_today: "business.toast.closedToday",
  running_late: "business.toast.late",
  storm: "business.toast.storm",
};

/** Spec §5.6.1 / SD19: the state's own toast, then "{persona} says so too." when a persona is known
 *  (never assumed for an account with no voice profile), then the To-do count when one was filed.
 *  `pseudo` wraps every piece through `makeTr`, same as every other string this component renders. */
export function buildChangeToast(
  change: StatusChange, todoCount: number, personaName: string | null, locale: Locale, pseudo = false,
): string {
  const tr = makeTr(locale, pseudo);
  let text = tr.text(STATE_TOAST_KEY[change.state]);
  if (personaName) text += ` ${tr.text("business.toast.persona", { persona: personaName })}`;
  if (todoCount > 0) {
    text += ` ${todoCount === 1 ? tr.text("business.toast.todoOne") : tr.text("business.toast.todo", { n: todoCount })}`;
  }
  return text;
}

export function BusinessStatusMenu({
  accountId, status, locale, pseudo = false, onChanged, trigger,
}: {
  accountId: string;
  status: ShellBusinessStatus;
  locale: Locale;
  pseudo?: boolean;
  onChanged?: (s: EffectiveStatus) => void;
  /** The caller's own visible content — the topbar's dot+words, or the card's "Change" text. The
   *  button's ACCESSIBLE name is always `business.menu.trigger`, independent of what is shown. */
  trigger: ReactNode;
}) {
  const router = useRouter();
  const shell = useShellData();
  const tr = makeTr(locale, pseudo);
  const [stormOpen, setStormOpen] = useState(false);
  const todayKey = dayKey(new Date(), status.timezone);
  const minBackOn = addDays(todayKey, 1);
  const maxBackOn = addDays(todayKey, 92);
  const [backOn, setBackOn] = useState(minBackOn);

  const plan = planMenu(status);
  if (plan.kind === "none") return <>{trigger}</>;

  const effective = fromWire(status.effective);
  const current = radioValue(effective);

  async function applyChange(change: StatusChange) {
    let result: Awaited<ReturnType<typeof setBusinessStatusAction>>;
    try {
      result = await setBusinessStatusAction(accountId, change, locale);
    } catch {
      toast.error(tr.text("business.toast.failed"));
      return;
    }
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const updated: ShellBusinessStatus = {
      effective: result.effective, canChange: status.canChange,
      timezone: status.timezone, personaName: status.personaName, now: new Date().toISOString(),
    };
    onChanged?.(fromWire(result.effective));
    shell?.setBusinessStatus(updated);
    router.refresh();

    const { undo } = result;
    toast.success(buildChangeToast(change, result.todoCount, status.personaName, locale, pseudo), {
      duration: UNDO_WINDOW_MS,
      action: { label: tr.text("common.undo"), onClick: () => void runUndo(undo) },
    });
  }

  async function runUndo(undo: UndoToken) {
    let result: Awaited<ReturnType<typeof undoBusinessStatusAction>>;
    try {
      result = await undoBusinessStatusAction(accountId, undo, locale);
    } catch {
      toast.error(tr.text("business.toast.failed"));
      return;
    }
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const restored: ShellBusinessStatus = {
      effective: result.effective, canChange: status.canChange,
      timezone: status.timezone, personaName: status.personaName, now: new Date().toISOString(),
    };
    onChanged?.(fromWire(result.effective));
    shell?.setBusinessStatus(restored);
    router.refresh();
    toast.success(tr.text("business.toast.undone"));
  }

  const closedDaysHref = `/dashboard/accounts/${accountId}/calendar#closed-days`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button" variant="ghost" aria-haspopup="menu"
            aria-label={tr.text("business.menu.trigger")}
            className="min-h-11 rounded-[var(--radius-ctl)] focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8"
          >
            {trigger}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup value={current}>
            {plan.kind === "all" && plan.openRow === "link" ? (
              <DropdownMenuItem asChild>
                <Link href={closedDaysHref}>{tr.text("business.menu.changeClosedDays")}</Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuRadioItem value="open" onSelect={() => void applyChange({ state: "open" })}>
                {tr.text("business.menu.open")}
              </DropdownMenuRadioItem>
            )}
            {plan.kind === "all" ? (
              <DropdownMenuRadioItem value="closed_today" onSelect={() => void applyChange({ state: "closed_today" })}>
                {tr.text("business.menu.closedToday")}
              </DropdownMenuRadioItem>
            ) : null}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{tr.text("business.menu.runningLate")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {LATE_OPTIONS.map((opt) => (
                  <DropdownMenuRadioItem
                    key={opt.value}
                    value={`running_late_${opt.value}`}
                    onSelect={() => void applyChange({ state: "running_late", lateMinutes: opt.value })}
                  >
                    {tr.text(opt.key)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {plan.kind === "all" ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{tr.text("business.menu.storm")}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioItem value="storm" onSelect={() => void applyChange({ state: "storm", backOn: null })}>
                    {tr.text("business.menu.stormOpenEnded")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setStormOpen(true); }}>
                    {tr.text("business.menu.stormBackOn")}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={stormOpen} onOpenChange={setStormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr.text("business.storm.title")}</DialogTitle>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-sm">
            {tr.text("business.storm.date")}
            <Input
              type="date" value={backOn} min={minBackOn} max={maxBackOn}
              onChange={(e) => setBackOn(e.target.value)}
            />
          </label>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => { setStormOpen(false); void applyChange({ state: "storm", backOn }); }}
            >
              {tr.text("business.storm.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
