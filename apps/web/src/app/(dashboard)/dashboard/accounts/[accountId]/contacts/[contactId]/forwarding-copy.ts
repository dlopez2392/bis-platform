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
