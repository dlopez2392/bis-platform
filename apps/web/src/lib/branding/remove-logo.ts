import { m } from "@/lib/messages";
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
): Promise<boolean> {
  let r: RemoveLogoResult;
  try {
    r = await remove();
  } catch {
    toast.error(m["common.actionCrashed"]);
    return false;
  }
  if (!r.ok) {
    toast.error(r.error);
    return false;
  }
  show(false);
  const path = r.path;
  toast.success(m["branding.logoRemoved"], {
    action: {
      label: m["common.undo"],
      onClick: () => {
        void (async () => {
          let u: RestoreLogoResult;
          try {
            u = await restore(path);
          } catch {
            toast.error(m["common.actionCrashed"]);
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
