"use client";

// S-47d Task 11 (plan "The topbar forms", spec §5.6.1): the one switch's own menu, mounted by BOTH the
// topbar indicator (its dot+words become the trigger) and the dashboard card (a plain "Change" button
// becomes the trigger) — `trigger` is the caller's own visible content, so this file draws the content
// once and never twice. DESIGN.md rule 6 (reversible, immediate, Undo toast) and rule 3 (dot+word, drawn
// by the CALLER, never here) both apply.
import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
// Fix round D10: the ONE Undo window every rule-6 toast on these surfaces lives for.
import { UNDO_WINDOW_MS } from "@/app/(dashboard)/dashboard/accounts/[accountId]/calendar/undo-window";

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

/**
 * The radio group's checked value: always one of the items' OWN values, or nothing would be checked
 * (fix round B5). A closed day checks "closed_today" (spec: "a closed day reads the same as Closed
 * today"), since the switch itself has no fifth value for it. Running late checks its own delay
 * (`running_late_30`), the value its item carries. A storm with a reopening date checks "Back on a
 * date…" (`storm_dated`, that item's own value) rather than "Until further notice", which would claim
 * the opposite of what is set; checking neither would hide what is set altogether, so the dated item
 * gets a value of its own. Choosing it again opens the date dialog, which is how the date is changed.
 */
export function radioValue(effective: EffectiveStatus): string {
  switch (effective.state) {
    case "closed_day": return "closed_today";
    case "running_late": return `running_late_${effective.lateMinutes}`;
    case "storm": return effective.reopensAt === null ? "storm" : "storm_dated";
    default: return effective.state;
  }
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
  accountId, status, locale, pseudo = false, onChanged, trigger, triggerKind = "status",
}: {
  accountId: string;
  status: ShellBusinessStatus;
  locale: Locale;
  pseudo?: boolean;
  onChanged?: (s: EffectiveStatus) => void;
  /** The caller's own visible content — the topbar's dot+words, or the card's "Change" text. */
  trigger: ReactNode;
  /**
   * Fix round C2 (design review I2): how the button is named. "status" (the topbar): the visible
   * status words, followed by `business.menu.trigger` as an sr-only suffix, so a screen reader hears
   * "Closed today, Change today's status" — an aria-label would REPLACE the status words. "action" (the
   * dashboard card, whose visible word is already the action, "Change"): `business.menu.trigger` is the
   * name, and the visible word is inside it.
   */
  triggerKind?: "status" | "action";
}) {
  const router = useRouter();
  const shell = useShellData();
  const tr = makeTr(locale, pseudo);
  const [stormOpen, setStormOpen] = useState(false);
  // Fix round D4: the dated storm item lets the menu CLOSE, and the dialog opens from the menu's own
  // onCloseAutoFocus — never a dialog stacked over a still-open menu (two modal layers fighting over
  // focus and `pointer-events` on body). The dialog then hands focus back to this trigger on close.
  const stormRequested = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
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
          {/* Fix round C1, measured on the built app: below sm the agency's topbar leaves a status trigger
              60px at 320px wide and 100px at 360px, and its content alone is 58px ("0 calls") to 93px
              ("Cerrado hoy"), so a status trigger carries NO horizontal padding there (px-4 from sm). Its
              content is at least 44px wide in every state, so the 44px tap target holds. The card's
              "Change" (an action trigger) is not in the topbar and keeps the button's own padding.
              minors-1b item 1: at the agency's own 320px the org switcher (already avatar-only there,
              F-107 r5) still leaves the indicator only 60px, 33px short of "Cerrado hoy" even at zero
              padding — there is no more room (a) can give up, so (b): `whitespace-normal` overrides the
              base Button's `whitespace-nowrap` and `shrink` overrides its `shrink-0`, so the trigger wraps
              the short status to two lines instead of overflowing, keeping dot + word (rule 3) and
              `min-h-11` (the tap target grows with it, never shrinks under it). The action trigger (the
              card's "Change") keeps the base button's own nowrap/shrink-0: it is never in the topbar. */}
          <Button
            ref={triggerRef}
            type="button" variant="ghost" aria-haspopup="menu"
            aria-label={triggerKind === "action" ? tr.text("business.menu.trigger") : undefined}
            className={triggerKind === "status"
              ? "min-h-11 shrink whitespace-normal rounded-[var(--radius-ctl)] px-0 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:px-4 md:min-h-8"
              : "min-h-11 rounded-[var(--radius-ctl)] focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8"}
          >
            {trigger}
            {triggerKind === "status" ? <span className="sr-only">{`, ${tr.text("business.menu.trigger")}`}</span> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end" lang={locale}
          onCloseAutoFocus={(e) => {
            if (stormRequested.current) {
              stormRequested.current = false;
              e.preventDefault();
              setStormOpen(true);
            }
          }}
        >
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
              <DropdownMenuSubContent lang={locale}>
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
                <DropdownMenuSubContent lang={locale}>
                  <DropdownMenuRadioItem value="storm" onSelect={() => void applyChange({ state: "storm", backOn: null })}>
                    {tr.text("business.menu.stormOpenEnded")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioItem
                    value="storm_dated"
                    onSelect={() => { stormRequested.current = true; }}
                  >
                    {tr.text("business.menu.stormBackOn")}
                  </DropdownMenuRadioItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={stormOpen} onOpenChange={setStormOpen}>
        <DialogContent lang={locale} onCloseAutoFocus={(e) => { e.preventDefault(); triggerRef.current?.focus(); }}>
          <DialogHeader>
            <DialogTitle>{tr.text("business.storm.title")}</DialogTitle>
            <DialogDescription>{tr.text("business.storm.description")}</DialogDescription>
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
