import { toast } from "sonner";
import type { RequirableCategory } from "@bis/db/document-rules";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import {
  skipDocumentRequirementAction, undoSkipDocumentRequirementAction,
  unskipDocumentRequirementAction, undoUnskipDocumentRequirementAction,
} from "./document-requirements-actions";

/**
 * What "Not needed" and "Needed again" do on the Documents card's checklist (S-07 2c, spec 5.4; rule 6:
 * at once, the toast carrying an Undo, no "Are you sure?"). Each success re-reads the checklist (`reload`)
 * and refreshes the server-rendered page (`refresh`, the card's router.refresh) so the timeline shows its
 * row; each Undo that lands does both again. An Undo is the server's own compare-and-set on what THIS
 * click wrote (the skip's id; the un-skip's exact instant). A refusal says its key's words and re-reads
 * nothing; a thrown action (a stale tab after a redeploy) says the checklist's own sentence (M9: never
 * common.actionCrashed, whose Spanish is in tú). `inFlight` (the card's one Set) ignores a second click on
 * the same item, keyed `skip:<category>`, while the first has not settled. documents-card-handlers.ts's
 * once/say/offer shape, copied rather than imported (theirs are private).
 */
type Answer = { ok: true } | { ok: false; error: string; params?: Record<string, string | number> };
const CRASHED = "documents.checklist.crashed";

export function checklistHandlers({ accountId, contactId, locale, reload, refresh, inFlight }: {
  accountId: string; contactId: string; locale: Locale; reload: () => void; refresh: () => void; inFlight: Set<string>;
}): { skip(c: RequirableCategory): Promise<void>; unskip(c: RequirableCategory): Promise<void> } {
  const tt = (key: string, params?: Record<string, string | number>) => t(m, key as MessageKey, locale, params);
  const say = (a: { error: string; params?: Record<string, string | number> }) => toast.error(tt(a.error, a.params));
  const crashed = { ok: false as const, error: CRASHED };
  const changed = () => { reload(); refresh(); };

  async function once<R>(id: string, run: () => Promise<R>): Promise<R | null> {
    if (inFlight.has(id)) return null;
    inFlight.add(id);
    try { return await run(); } finally { inFlight.delete(id); }
  }

  function offer(message: string, row: string, undo: () => Promise<Answer>) {
    toast.success(message, { action: { label: tt("common.undo"), onClick: () => {
      void once(row, () => undo().catch(() => crashed)).then((u) => { if (!u) return; if (u.ok) changed(); else say(u); });
    } } });
  }

  const row = (c: RequirableCategory) => `skip:${c}`;
  const word = (c: RequirableCategory) => tt(`documents.category.${c}`);

  return {
    async skip(c) {
      const r = await once(row(c), () => skipDocumentRequirementAction(accountId, contactId, c).catch(() => crashed));
      if (!r) return;
      if (!r.ok) { say(r); return; }
      changed();
      offer(tt("documents.checklist.skipped", { category: word(c) }), row(c), () => undoSkipDocumentRequirementAction(accountId, r.skipId));
    },
    async unskip(c) {
      const r = await once(row(c), () => unskipDocumentRequirementAction(accountId, contactId, c).catch(() => crashed));
      if (!r) return;
      if (!r.ok) { say(r); return; }
      changed();
      offer(tt("documents.checklist.unskipped", { category: word(c) }), row(c),
        () => undoUnskipDocumentRequirementAction(accountId, r.skipId, r.unskippedAt));
    },
  };
}
