"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GroupKind } from "@bis/db";
import { Button, buttonVariants } from "@/components/ui/button";
import { InlineField } from "@/components/inline-field";
import { useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { PEOPLE_ANCHOR } from "@/lib/record/group-header";
import { peopleHandlers } from "./people-handlers";

export type PeopleRow = {
  memberId: string; contactId: string; name: string; role: string | null; isBilling: boolean; isPrimaryContact: boolean;
};
type Handlers = ReturnType<typeof peopleHandlers>;
type Tt = (key: MessageKey, params?: Record<string, string | number>) => string;

const focus = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const rowLine = "border-t border-[var(--row-line)] first:border-t-0";

/**
 * People (S-03 part 2, plan Task 6, spec §8.2): the call-first member pinned first (C10), then
 * everyone else in the order they joined, 30 a page, one pager at the foot. A row holds inline
 * fields, so it is not a row-click table: the NAME is the link to that person's page. Owner, Staff
 * and the agency choose who we call first and remove; a Technician edits role and Pays the bills on
 * their own customers' rows (plan deviation 6, groups-actions.ts's A6/C3).
 */
export function PeopleCardView(p: {
  accountId: string; groupId: string; kind: GroupKind; manager: boolean; primary: PeopleRow | null; rows: PeopleRow[];
  paged: boolean; pager: { moreHref: string | null; firstHref: string | null }; handlers: Handlers;
}) {
  const locale = useLocale();
  const tt: Tt = (key, params) => t(m, key, locale, params);
  const shown = !p.paged && p.primary ? [p.primary, ...p.rows] : p.rows;
  if (shown.length === 0 && !p.paged) {
    return (
      <p data-people-empty lang={locale} className="text-sm text-muted-foreground">
        {tt(p.kind === "household" ? "groupPage.people.emptyHousehold" : "groupPage.people.emptyBusiness")}
      </p>
    );
  }
  return (
    <div id={PEOPLE_ANCHOR} lang={locale} className="scroll-mt-4 space-y-2">
      {p.manager && !p.paged && !p.primary && shown.length > 0
        ? <p data-people-prompt className="text-sm text-card-foreground">{tt("groupPage.people.choosePrimary")}</p> : null}
      <ul className="flex flex-col">
        {shown.map((row) => (
          <PersonRow key={row.memberId} accountId={p.accountId} manager={p.manager} row={row} handlers={p.handlers} tt={tt} locale={locale} />
        ))}
      </ul>
      {p.pager.moreHref || p.pager.firstHref ? (
        <nav aria-label={tt("groupPage.people.pages")} data-people-pager className="flex items-center justify-end gap-2">
          {p.pager.firstHref ? (
            <Link href={p.pager.firstHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 md:min-h-8")}>
              {tt("groupPage.people.first")}
            </Link>
          ) : null}
          {p.pager.moreHref ? (
            <Link href={p.pager.moreHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 md:min-h-8")}>
              {tt("groupPage.people.more")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

function PersonRow({ accountId, manager, row, handlers, tt, locale }: {
  accountId: string; manager: boolean; row: PeopleRow; handlers: Handlers; tt: Tt; locale: ReturnType<typeof useLocale>;
}) {
  const [busy, setBusy] = useState(false);
  const act = (run: () => Promise<unknown>) => async () => {
    if (busy) return;
    setBusy(true);
    try { await run(); } finally { setBusy(false); }
  };
  return (
    <li data-people-row={row.memberId} className={cn(rowLine, "space-y-1.5 py-2.5 first:pt-0")}>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/dashboard/accounts/${accountId}/contacts/${row.contactId}`} data-people-name title={row.name}
          className={cn("min-w-0 flex-1 truncate rounded-[var(--radius-ctl)] font-medium text-card-foreground underline-offset-4 hover:underline", focus)}>
          {row.name}
        </Link>
        {row.isPrimaryContact ? (
          <span data-people-mark="primary-contact" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />{tt("groupPage.people.primaryContact")}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {manager && !row.isPrimaryContact ? (
          <Button size="sm" variant="ghost" className="min-h-11 md:min-h-8" disabled={busy}
            onClick={act(() => handlers.makePrimaryContact({ memberId: row.memberId, name: row.name }))}>
            {tt("groupPage.people.makePrimaryContact")}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className="min-h-11 md:min-h-8" aria-pressed={row.isBilling} disabled={busy}
          onClick={act(() => handlers.toggleBilling({ memberId: row.memberId, isBilling: row.isBilling }))}>
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", row.isBilling ? "bg-[var(--good)]" : "border border-[var(--line-strong)]")} />
            {tt("groups.billing")}
          </span>
        </Button>
        {manager ? (
          <Button size="sm" variant="ghost" className="ml-auto min-h-11 text-muted-foreground md:min-h-8" disabled={busy}
            aria-label={`${tt("groups.remove")}: ${row.name}`}
            onClick={act(() => handlers.remove({ memberId: row.memberId, name: row.name }))}>
            {tt("groups.remove")}
          </Button>
        ) : null}
      </div>
      <dl className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2">
        <dt className="text-xs text-muted-foreground">{tt("groups.role")}</dt>
        <dd className="min-w-0">
          <InlineField key={`role:${row.role ?? ""}`} label={tt("groups.role")} field="source" value={row.role} locale={locale}
            placeholder={tt("groups.rolePlaceholder")} save={handlers.roleSave(row.memberId)} undoWith={handlers.roleUndo(row.memberId)} />
        </dd>
      </dl>
    </li>
  );
}

/** The card on the page: builds the handlers; every landed write refreshes the server-rendered page. */
export function PeopleCard(props: Omit<Parameters<typeof PeopleCardView>[0], "handlers">) {
  const router = useRouter();
  const locale = useLocale();
  const handlers = peopleHandlers({ accountId: props.accountId, groupId: props.groupId, locale, onChanged: () => router.refresh() });
  return <PeopleCardView {...props} handlers={handlers} />;
}
