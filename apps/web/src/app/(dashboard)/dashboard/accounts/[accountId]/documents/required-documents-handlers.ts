import { toast } from "sonner";
import { cleanRequiredCategories, type RequirableCategory } from "@bis/db/document-rules";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { RequiredUndoAnswer } from "./required-documents-actions";

/**
 * What the Owner card's Save does (S-07 3a, spec 3.3; rule 6: at once, Undo in the toast). The save is
 * 2c's action (it admits an Owner); its English `error` is not shown (plan deviation 11): the card says
 * its own words in the reader's language. The Undo is a compare-and-set (plan deviation 9): it restores
 * `before` only while the stored list is still what this save wrote.
 */
type SaveAnswer = { ok: true; list: string[] } | { ok: false; error: string };

export function requiredListHandlers({ locale, save, undo, onChange }: {
  locale: Locale;
  save: (formData: FormData) => Promise<SaveAnswer>;
  undo: (expected: string[], previous: string[]) => Promise<RequiredUndoAnswer>;
  onChange: (list: RequirableCategory[]) => void;
}): { submit(formData: FormData, before: RequirableCategory[]): Promise<void> } {
  const tt = (key: MessageKey) => t(m, key, locale);
  return {
    async submit(formData, before) {
      let r: SaveAnswer;
      try {
        r = await save(formData);
      } catch {
        toast.error(tt("documents.required.crashed"));
        return;
      }
      if (!r.ok) {
        toast.error(tt("documents.required.failed"));
        return;
      }
      const after = cleanRequiredCategories(r.list) ?? [];
      onChange(after);
      toast.success(tt(after.length === 0 ? "settings.requiredDocuments.savedOff" : "settings.requiredDocuments.saved"), {
        action: {
          label: tt("common.undo"),
          onClick: () => {
            void (async () => {
              let u: RequiredUndoAnswer;
              try {
                u = await undo(after, before);
              } catch {
                toast.error(tt("documents.required.crashed"));
                return;
              }
              if (u.ok) {
                onChange(before);
                toast.success(tt("documents.required.restored"));
              } else {
                toast.error(tt(u.error));
              }
            })();
          },
        },
      });
    },
  };
}
