import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { AiGlobalResult, AiPrior, AiSaveResult } from "./ai-actions";

/**
 * What Save and the global switch do on the AI card (spec 3.6; rule 6: at once, the toast carrying an Undo).
 * A refusal says its key's words; a thrown action (a stale tab after a redeploy) says the card's own crash
 * sentence (never common.actionCrashed, whose Spanish is in tu). The account Save's Undo passes back BOTH what
 * the write wrote and what it replaces, a compare-and-set against the write (ai-actions.ts's convention). The
 * global Undo after turning AI ON turns it off again with the reader's own word, and `expected` = the state the
 * action it undoes WROTE (the opposite of the Undo's own direction), which the server re-checks as a CAS too.
 */
type Toast = {
  success(text: string, opts?: { action: { label: string; onClick: () => void } }): unknown;
  error(text: string): unknown;
};
export function aiCardHandlers(d: {
  locale: Locale; toast: Toast; refresh: () => void;
  save: (input: { enabled: boolean; budget: string }) => Promise<AiSaveResult>;
  undo: (prior: AiPrior, wrote: AiPrior) => Promise<AiSaveResult>;
  setGlobal: (input: { enabled: boolean; confirm?: string; expected?: boolean }) => Promise<AiGlobalResult>;
}): { save(input: { enabled: boolean; budget: string }): Promise<boolean>; setGlobal(enabled: boolean, confirm?: string): Promise<boolean> } {
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, d.locale, params);
  const word = tt("aiSettings.global.confirmWord");
  const crashed = { ok: false as const, error: "aiSettings.crashed" as const };
  const say = (error: MessageKey) => d.toast.error(tt(error, error === "aiSettings.global.wrongWord" ? { word } : undefined));

  return {
    async save(input) {
      const r = await d.save(input).catch(() => crashed);
      if (!r.ok) { say(r.error); return false; }
      d.refresh();
      d.toast.success(tt("aiSettings.saved"), { action: { label: tt("common.undo"), onClick: () => {
        void d.undo(r.prior, r.wrote).catch(() => crashed).then((u) => {
          if (!u.ok) { say(u.error); return; }
          d.refresh();
          d.toast.success(tt("aiSettings.undone"));
        });
      } } });
      return true;
    },
    async setGlobal(enabled, confirm) {
      const r = await d.setGlobal({ enabled, confirm }).catch(() => crashed);
      if (!r.ok) { say(r.error); return false; }
      d.refresh();
      d.toast.success(tt(enabled ? "aiSettings.global.turnedOn" : "aiSettings.global.turnedOff"), { action: { label: tt("common.undo"), onClick: () => {
        void d.setGlobal({ enabled: r.prior, confirm: r.prior ? undefined : word, expected: enabled }).catch(() => crashed).then((u) => {
          if (!u.ok) { say(u.error); return; }
          d.refresh();
        });
      } } });
      return true;
    },
  };
}
