"use client";

import { useRouter } from "next/navigation";
import type { GroupKind } from "@bis/db";
import { InlineField } from "@/components/inline-field";
import { useLocale } from "@/components/locale-provider";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { renameGroupAction, setBillingAddressAction, type GroupResult } from "../../contacts/groups-actions";
import { groupErrorText } from "./people-handlers";

type InlineResult = { ok: true; undoPayload?: unknown } | { ok: false; error: string };

/** The inline saves. InlineField runs the Undo with the payload a save hands back (`undoWith`), so
 *  the Undo writes the server's own `previous`, never a value captured here (groups-card.tsx's rule). */
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
/** The name edits under `source`'s rule (trim, free text) and refuses a blank HERE: InlineField's
 *  `required` rule speaks of a "company" (groups-card.tsx's own rule, same wording this card reuses). */
const nameSave = (accountId: string, groupId: string, locale: Locale, onChanged: () => void) =>
  (v: string): Promise<InlineResult> =>
    v === "" ? Promise.resolve({ ok: false, error: t(m, "groups.nameEmpty", locale) })
      : toInline(() => renameGroupAction(accountId, groupId, v), locale, onChanged);
/** "" clears: setBillingAddressAction and the database store null for it. */
const addressSave = (accountId: string, groupId: string, locale: Locale, onChanged: () => void) =>
  (v: string): Promise<InlineResult> =>
    toInline(() => setBillingAddressAction(accountId, groupId, v === "" ? null : v), locale, onChanged);

const kindKey = (k: GroupKind): MessageKey => (k === "household" ? "groups.kind.household" : "groups.kind.business");
const fieldRow = "grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2";

/**
 * Details (S-03 part 2, plan Task 6, spec §8.2): the group's name, type and billing address. The
 * TYPE is a fact the database keeps (a household or a business is set at creation, S-02 part 1) and
 * is never editable here; name and billing address are the Groups card's own edits (plan deviation
 * 5) widened to the group's own page — no contact id, so the group's own `renameGroupAction` and
 * `setBillingAddressAction`. A narrow reader (a Technician) reads all three as plain text; the
 * server refuses the write regardless (groups-actions.ts's `provenGroupForManager`).
 */
export function DetailsCardView(p: {
  accountId: string; groupId: string; name: string; kind: GroupKind; billingAddress: string | null;
  manager: boolean; onChanged: () => void;
}) {
  const locale = useLocale();
  const tt = (key: MessageKey) => t(m, key, locale);
  return (
    <dl lang={locale} className="space-y-1">
      <div className={fieldRow}>
        <dt className="text-xs text-muted-foreground">{tt("groups.name")}</dt>
        <dd className="min-w-0">
          {p.manager ? (
            <InlineField label={tt("groups.name")} field="source" value={p.name} locale={locale}
              save={nameSave(p.accountId, p.groupId, locale, p.onChanged)}
              undoWith={(prev) => inlineUndo(() => renameGroupAction(p.accountId, p.groupId, prev as string), locale, p.onChanged)} />
          ) : <span className="block truncate text-sm text-foreground" title={p.name}>{p.name}</span>}
        </dd>
      </div>
      <div className={fieldRow}>
        <dt className="text-xs text-muted-foreground">{tt("groupPage.details.type")}</dt>
        <dd className="min-w-0 text-sm text-foreground">{tt(kindKey(p.kind))}</dd>
      </div>
      <div className={fieldRow}>
        <dt className="text-xs text-muted-foreground">{tt("groups.billingAddress")}</dt>
        <dd className="min-w-0">
          {p.manager ? (
            <InlineField label={tt("groups.billingAddress")} field="source" value={p.billingAddress} locale={locale}
              save={addressSave(p.accountId, p.groupId, locale, p.onChanged)}
              undoWith={(prev) => inlineUndo(() => setBillingAddressAction(p.accountId, p.groupId, prev as string | null), locale, p.onChanged)} />
          ) : <span className="block [overflow-wrap:anywhere] text-sm text-foreground">{p.billingAddress ?? ""}</span>}
        </dd>
      </div>
    </dl>
  );
}

/** The card on the page: router.refresh() on every landed save (a rename can change the Business name every member shows). */
export function DetailsCard(props: Omit<Parameters<typeof DetailsCardView>[0], "onChanged">) {
  const router = useRouter();
  return <DetailsCardView {...props} onChanged={() => router.refresh()} />;
}
