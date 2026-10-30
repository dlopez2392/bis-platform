"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import type { VisitRowView } from "@/lib/access-log/view";

/**
 * F-118 part 1 (spec 6.2): one visit per `<li>`, newest first (the page's own order — this component
 * never re-sorts). The label is the Label role; the when line carries tabular-nums; the summary is one
 * sentence. A row with items gets a ghost toggle that expands its items list in place. The row is not
 * a click target: rule 4's whole-row target and the record-views drawer are for rows that ARE records,
 * and a visit is not one — it opens no drawer and has no page of its own. Only its ITEMS link, through
 * `next/link`, and a gone item is plain text, never a link.
 */
function BisAccessRow({ row }: { row: VisitRowView }) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const itemsId = `bis-access-items-${useId()}`;
  return (
    <li data-bis-access-visit={row.id} className="space-y-1 border-b border-[var(--line)] py-3 last:border-b-0">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-3)]">{row.label}</p>
      <p className="tabular-nums text-sm text-[var(--text-1)]">{row.when}</p>
      <p className="text-sm text-[var(--text-2)]">{row.summary}</p>
      {row.items.length > 0 ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={itemsId}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? t(m, "accessLog.hide", locale) : t(m, "accessLog.show", locale)}
          </Button>
          <ul id={itemsId} hidden={!open} className="space-y-1 pl-3 text-sm">
            {row.items.map((it) => (
              <li key={it.key}>
                {it.href ? <Link href={it.href} className="hover:underline">{it.text}</Link> : <span className="text-[var(--text-2)]">{it.text}</span>}
              </li>
            ))}
            {row.more ? <li className="text-[var(--text-3)]">{row.more}</li> : null}
          </ul>
        </>
      ) : null}
    </li>
  );
}

export function BisAccessList({ rows }: { rows: VisitRowView[] }) {
  return (
    <ul className="space-y-0">
      {rows.map((row) => <BisAccessRow key={row.id} row={row} />)}
    </ul>
  );
}
