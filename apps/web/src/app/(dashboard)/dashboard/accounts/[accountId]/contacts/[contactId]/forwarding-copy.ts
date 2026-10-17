import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/** Spec §1: Copy toasts "Copied", no Undo. Plan G12: a refused clipboard says how to copy by hand. */
export async function copyForwardingAddress(
  address: string, clipboard: { writeText: (s: string) => Promise<void> } | undefined,
  toast: { success: (s: string) => unknown; error: (s: string) => unknown }, locale: Locale,
): Promise<boolean> {
  try {
    if (!clipboard) throw new Error("no clipboard");
    await clipboard.writeText(address);
    toast.success(t(m, "contact.forwarding.copied", locale));
    return true;
  } catch {
    toast.error(t(m, "contact.forwarding.copyFailed", locale));
    return false;
  }
}

/**
 * Owner ruling 2026-10-17 (amending G15): "Get forwarding address" makes the token on click, through
 * the record's server action. Constraints §13: a thrown action (a stale page, a dropped connection)
 * toasts `common.actionCrashed`, never an unhandled rejection; a refusal toasts its own plain line.
 * Answers the address, or null.
 */
export async function getForwardingAddress(
  action: () => Promise<{ ok: true; address: string } | { ok: false }>,
  toast: { error: (s: string) => unknown }, locale: Locale,
): Promise<string | null> {
  let r: Awaited<ReturnType<typeof action>>;
  try {
    r = await action();
  } catch {
    toast.error(t(m, "common.actionCrashed", locale));
    return null;
  }
  if (r.ok) return r.address;
  toast.error(t(m, "contact.forwarding.getFailed", locale));
  return null;
}
