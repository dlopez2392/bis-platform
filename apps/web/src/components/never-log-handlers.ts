import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import type { AddNeverLogActionResult, RemoveNeverLogActionResult, NeverLogView } from "@/app/(dashboard)/dashboard/accounts/[accountId]/never-log-actions";

/**
 * Every call NeverLogList makes into the server, Undo included, goes through here so a THROWN action
 * (a stale deployment, an expired session) toasts common.actionCrashed instead of doing nothing (part 1,
 * Tasks 10b/11b/12b). State is written by the caller's callbacks only AFTER the server answered ok.
 */
export type NeverLogToast = {
  success: (message: string, opts?: { action: { label: string; onClick: () => void } }) => unknown;
  error: (message: string) => unknown;
};
export type NeverLogDeps = {
  add: (input: string) => Promise<AddNeverLogActionResult>;
  remove: (id: string) => Promise<RemoveNeverLogActionResult>;
  toast: NeverLogToast;
  locale: Locale;
  onAdded: (entry: NeverLogView) => void;
  onRemoved: (id: string) => void;
  onInlineError: (message: string | null) => void;
};

const INLINE = { invalid: "neverLog.invalid", duplicate: "neverLog.duplicate", full: "neverLog.full" } as const;

async function guarded<T>(d: NeverLogDeps, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch {
    d.toast.error(t(m, "common.actionCrashed", d.locale));
    return null;
  }
}

function undoButton(d: NeverLogDeps, onClick: () => Promise<void>) {
  return { action: { label: t(m, "common.undo", d.locale), onClick: () => { void onClick(); } } };
}

export async function runAddNeverLog(d: NeverLogDeps, input: string): Promise<boolean> {
  d.onInlineError(null);
  const r = await guarded(d, () => d.add(input));
  if (!r) return false;
  if (!r.ok) {
    if (r.error === "failed") d.toast.error(t(m, "neverLog.failed", d.locale));
    else d.onInlineError(t(m, INLINE[r.error], d.locale));
    return false;
  }
  const entry = r.entry;
  d.onAdded(entry);
  d.toast.success(t(m, "neverLog.added", d.locale, { pattern: entry.pattern }), undoButton(d, async () => {
    const u = await guarded(d, () => d.remove(entry.id));
    if (!u) return;
    if (!u.ok) { d.toast.error(t(m, "neverLog.failed", d.locale)); return; }
    d.onRemoved(entry.id);
    d.toast.success(t(m, "neverLog.undone", d.locale));
  }));
  return true;
}

export async function runRemoveNeverLog(d: NeverLogDeps, entry: NeverLogView): Promise<boolean> {
  const r = await guarded(d, () => d.remove(entry.id));
  if (!r) return false;
  if (!r.ok) { d.toast.error(t(m, "neverLog.failed", d.locale)); return false; }
  d.onRemoved(entry.id);
  if (!r.removed) return true;   // someone else removed it first: nothing of ours to undo
  const removed = r.removed;
  d.toast.success(t(m, "neverLog.removed", d.locale, { pattern: removed.pattern }), undoButton(d, async () => {
    const u = await guarded(d, () => d.add(removed.pattern));
    if (!u) return;
    if (!u.ok) { d.toast.error(t(m, u.error === "failed" ? "neverLog.failed" : INLINE[u.error], d.locale)); return; }
    d.onAdded(u.entry);
    d.toast.success(t(m, "neverLog.undone", d.locale));
  }));
  return true;
}
