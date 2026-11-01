import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import type { ToastLike } from "@/lib/ui/guarded-run";

export type RemoveLogoResult = { ok: true; path: string } | { ok: false; error: string };
export type RestoreLogoResult = { ok: true } | { ok: false; error: string };

/**
 * The Branding card's "Remove logo" button, minus React (DESIGN.md rule 6:
 * reversible actions run at once, no confirm dialog, Undo on the toast —
 * mirrors `lib/consent/email-row.ts`'s `runEmailAction` for the same shape).
 *
 * `show(hasLogo)` is the only hook into the panel's own state: `false` right
 * after Remove succeeds (so the preview and the button disappear at once),
 * `true` if Undo restores it. The server already did the real work by the
 * time either fires — this only keeps what's on screen honest about it.
 */
export async function runRemoveLogo(
  remove: () => Promise<RemoveLogoResult>,
  restore: (path: string) => Promise<RestoreLogoResult>,
  show: (hasLogo: boolean) => void,
  toast: ToastLike,
  // S-10 T6: optional, defaulting to "en" — every m[...] read below was
  // bare English, regardless of the caller's own locale. This module's one
  // real caller (branding-panel.tsx) passes its resolved locale.
  locale: Locale = "en",
): Promise<boolean> {
  let r: RemoveLogoResult;
  try {
    r = await remove();
  } catch {
    toast.error(t(m, "common.actionCrashed", locale));
    return false;
  }
  if (!r.ok) {
    toast.error(r.error);
    return false;
  }
  show(false);
  const path = r.path;
  toast.success(t(m, "branding.logoRemoved", locale), {
    action: {
      label: t(m, "common.undo", locale),
      onClick: () => {
        void (async () => {
          let u: RestoreLogoResult;
          try {
            u = await restore(path);
          } catch {
            toast.error(t(m, "common.actionCrashed", locale));
            return;
          }
          if (u.ok) show(true);
          else toast.error(u.error);
        })();
      },
    },
  });
  return true;
}
