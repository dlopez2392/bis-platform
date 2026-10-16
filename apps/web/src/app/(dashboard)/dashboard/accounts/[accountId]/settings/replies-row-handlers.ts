import { m } from "@/lib/messages";
import type { InboundMode } from "@bis/db";
import type { InboundModeResult, DnsCheckResult } from "./actions";

export const MODE_LABEL: Record<InboundMode, string> = {
  off: m["settings.replies.off"],
  bis: m["settings.replies.bis"],
  own_domain: m["settings.replies.own"],
};

export type RepliesSettings = { mode: InboundMode; domain: string | null };

export type RepliesToast = {
  success: (message: string, opts?: { action: { label: string; onClick: () => void } }) => unknown;
  error: (message: string) => unknown;
};

/**
 * Every call this row makes into the server goes through here. Fix round 1
 * (code review): `chooseOffOrBis`, the Check-DNS-then-save path and the
 * Undo button's own `onClick` used to call `setReplies`/`checkDns` with no
 * catch — a THROWN server action (a stale deployment, an expired session;
 * `lib/forms/action-feedback.ts`'s own documented incident) showed no toast
 * at all, same shape that incident already fixed for `SendingAddressCard`'s
 * Save above (`notifyActionResult`). This is that same catch, generalised
 * over both `setReplies` and `checkDns`'s differently-shaped results.
 *
 * Local state (`applied`/`selected`/`domainInput`/`dnsResult`) is never
 * written by the caller until AFTER this resolves successfully (see
 * `applyReplies` below) — so a throw leaves it exactly where it was. There
 * is nothing to roll back; the toast alone is the fix.
 */
async function guarded<T>(run: () => Promise<T>, toast: RepliesToast): Promise<T | null> {
  try {
    return await run();
  } catch {
    toast.error(m["common.actionCrashed"]);
    return null;
  }
}

export type ApplyRepliesDeps = {
  setReplies: (next: RepliesSettings) => Promise<InboundModeResult>;
  toast: RepliesToast;
  /** Called only once `setReplies` has answered `{ ok: true }`. */
  onApplied: (next: RepliesSettings) => void;
  /** Called only once the UNDO's own `setReplies` call has answered `{ ok: true }`. */
  onUndone: (previous: RepliesSettings) => void;
};

/**
 * Writes `next` and, on success, arms the Undo toast. The Undo action is
 * itself routed through `guarded`, so a throw while undoing toasts
 * `common.actionCrashed` too, rather than leaving a toast button that does
 * nothing when clicked. Returns whether the write landed, for the caller's
 * own `selected`/`domainInput` bookkeeping after a Check-DNS-then-save.
 */
export async function applyReplies(deps: ApplyRepliesDeps, next: RepliesSettings): Promise<boolean> {
  const result = await guarded(() => deps.setReplies(next), deps.toast);
  if (!result) return false;
  if (!result.ok) { deps.toast.error(result.error); return false; }
  deps.onApplied(next);
  const previous = result.previous;
  deps.toast.success(m["settings.replies.saved"].replace("{mode}", MODE_LABEL[next.mode]), {
    action: {
      label: m["common.undo"],
      onClick: () => {
        void guarded(() => deps.setReplies(previous), deps.toast).then((back) => {
          if (!back) return;
          if (!back.ok) { deps.toast.error(back.error); return; }
          deps.onUndone(previous);
          deps.toast.success(m["settings.replies.undone"].replace("{mode}", MODE_LABEL[previous.mode]));
        });
      },
    },
  });
  return true;
}

/** Same guard, for the DNS check alone — `null` on a throw (toasted already), the server's own answer otherwise. */
export async function probeDns(
  checkDns: (domain: string) => Promise<DnsCheckResult>, domain: string, toast: RepliesToast,
): Promise<DnsCheckResult | null> {
  return guarded(() => checkDns(domain), toast);
}
