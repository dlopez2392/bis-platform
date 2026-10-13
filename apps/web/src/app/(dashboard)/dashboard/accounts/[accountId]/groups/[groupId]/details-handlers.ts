import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { renameGroupAction, setBillingAddressAction, type GroupResult } from "../../contacts/groups-actions";
import { groupErrorText } from "./people-handlers";

/**
 * Details' writes (S-03 part 2, plan Task 6, review round 1 finding 1): pulled out of
 * details-card.tsx so the save/Undo wiring is a plain function of its OWN arguments, never a
 * value closed over from a prop — the shape that let an earlier version's Undo resend the
 * client's currently-displayed name instead of the server's `previous` and still pass every
 * component test (the component never exercised an Undo whose server answer differed from what
 * was on screen). `InlineField` runs the Undo with the payload a save hands back (`undoWith`), so
 * both writes below answer with the server's own `previous`, never a value captured here
 * (groups-card.tsx's rule, reused by people-handlers.ts's `makePrimaryContact`/`remove`).
 */
type InlineResult = { ok: true; undoPayload?: unknown } | { ok: false; error: string };

async function toInline<P>(
  write: () => Promise<GroupResult<{ previous: P }>>, locale: Locale, onChanged: () => void,
): Promise<InlineResult> {
  let r: GroupResult<{ previous: P }>;
  try { r = await write(); } catch { return { ok: false, error: t(m, "groups.failed", locale) }; }
  if (!r.ok) return { ok: false, error: groupErrorText(r.error, locale) };
  onChanged();
  return { ok: true, undoPayload: r.previous };
}
async function inlineUndo(
  write: () => Promise<GroupResult>, locale: Locale, onChanged: () => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let r: GroupResult;
  try { r = await write(); } catch { return { ok: false, error: t(m, "groups.failed", locale) }; }
  if (!r.ok) return { ok: false, error: groupErrorText(r.error, locale) };
  onChanged();
  return { ok: true };
}

export function detailsHandlers({ accountId, groupId, locale, onChanged }: {
  accountId: string; groupId: string; locale: Locale; onChanged: () => void;
}) {
  return {
    /** The name edits under `source`'s rule (trim, free text) and refuses a blank HERE: InlineField's
     *  `required` rule speaks of a "company" (groups-card.tsx's own rule, same wording reused). */
    nameSave: (v: string): Promise<InlineResult> =>
      v === "" ? Promise.resolve({ ok: false, error: t(m, "groups.nameEmpty", locale) })
        : toInline(() => renameGroupAction(accountId, groupId, v), locale, onChanged),
    /** Takes exactly the payload `nameSave` handed back (the server's `previous`); never reads
     *  anything else, so it cannot resend a value this module did not receive as an argument. */
    nameUndo: (prev: unknown) => inlineUndo(() => renameGroupAction(accountId, groupId, prev as string), locale, onChanged),
    /** "" clears: setBillingAddressAction and the database store null for it. */
    addressSave: (v: string): Promise<InlineResult> =>
      toInline(() => setBillingAddressAction(accountId, groupId, v === "" ? null : v), locale, onChanged),
    addressUndo: (prev: unknown) =>
      inlineUndo(() => setBillingAddressAction(accountId, groupId, prev as string | null), locale, onChanged),
  };
}
