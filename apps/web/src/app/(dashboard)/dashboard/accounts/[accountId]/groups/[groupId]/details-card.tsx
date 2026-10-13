"use client";

import { useRouter } from "next/navigation";
import type { GroupKind } from "@bis/db";
import { InlineField } from "@/components/inline-field";
import { useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { detailsHandlers } from "./details-handlers";

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
  const handlers = detailsHandlers({ accountId: p.accountId, groupId: p.groupId, locale, onChanged: p.onChanged });
  return (
    <dl lang={locale} className="space-y-1">
      <div className={fieldRow}>
        <dt className="text-xs text-muted-foreground">{tt("groups.name")}</dt>
        <dd className="min-w-0">
          {p.manager ? (
            <InlineField label={tt("groups.name")} field="source" value={p.name} locale={locale}
              save={handlers.nameSave} undoWith={handlers.nameUndo} />
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
              save={handlers.addressSave} undoWith={handlers.addressUndo} />
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
