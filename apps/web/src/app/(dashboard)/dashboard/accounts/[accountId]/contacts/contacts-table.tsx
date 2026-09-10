"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Mail, Phone } from "lucide-react";
import type { SortKey, SortDir } from "@bis/db";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { ListPanel } from "@/components/ui/list-panel";
import { contactDisplayName, formatDate, initials } from "@/lib/format";
import { m } from "@/lib/messages";
import { usePeek } from "@/lib/contacts/use-peek";
import { pageSelectionState, togglePageSelection } from "@/lib/contacts/selection";
import { ContactDrawer } from "./contact-drawer";
import { BulkActionBar } from "./bulk-action-bar";

export type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  created_at: string;
};

// A `?peek=` id absent from the current page's rows (deleted, or on another
// page of the server's cursor pager) still opens the drawer — the stub's
// empty fields render as empty InlineFields and the summary fetch 404s into
// the drawer's error state, which is exactly the spec's deleted-contact
// behavior.
function missingRow(id: string): ContactRow {
  return {
    id, first_name: null, last_name: null, email: null, phone: null,
    company_name: null, created_at: "",
  };
}

/**
 * The href a click on `key`'s column header navigates to. Toggles direction
 * when `key` is already the active sort; otherwise starts that column at
 * ascending (the old client-side toggleSort's own default for a
 * newly-clicked column, preserved here). `q` rides along so a search stays
 * applied across a re-sort; `before` NEVER does — there is no parameter here
 * to plumb one through even by accident. A cursor taken from one sort's
 * ordering is meaningless on another's, so changing the sort always returns
 * to the head of the (newly ordered) list, exactly like a fresh page load.
 */
export function sortHref(
  accountId: string, current: { key: SortKey; dir: SortDir }, key: SortKey, q?: string,
): string {
  const dir: SortDir = current.key === key && current.dir === "asc" ? "desc" : "asc";
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("sort", key);
  params.set("dir", dir);
  return `/dashboard/accounts/${accountId}/contacts?${params}`;
}

export function ContactsTable({
  rows,
  accountId,
  existingTags,
  sort,
  dir,
  q,
}: {
  rows: ContactRow[];
  accountId: string;
  existingTags: { id: string; name: string }[];
  /** The sort actually applied to `rows` server-side — already validated by
   *  the page, so this component only ever has to render it, never guess a
   *  fallback for it. */
  sort: SortKey;
  dir: SortDir;
  /** The current search text, carried into a re-sort's href so it survives
   *  clicking a column header. */
  q?: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { peekId, open, close } = usePeek();
  // Which column's header button should regain focus once THIS click's
  // navigation lands — a ref, not state, because setting it must not itself
  // trigger a render; it only needs to survive until the effect below runs
  // against the NEW `sort`/`dir` props the navigation produced.
  const pendingFocusKey = useRef<SortKey | null>(null);

  useEffect(() => {
    const key = pendingFocusKey.current;
    if (!key) return;
    pendingFocusKey.current = null;
    // Deferred one frame past this commit's own effects — and past Next's,
    // which fire the same way — so this call is the LAST word on focus
    // rather than one more effect the App Router's own post-navigation
    // handling could still override. Queried by attribute rather than a
    // stored ref because the re-render behind this navigation may hand back
    // an entirely new DOM node for this button, not the one that had focus
    // when it was clicked.
    const raf = requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-sort-key="${key}"]`)?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [sort, dir]);

  function toggleSort(key: SortKey) {
    pendingFocusKey.current = key;
    // A sort click re-renders this same page with new rows, not a real page
    // change (use-peek.ts documents the same router.push re-renders the
    // whole server component tree) — `scroll: false` stops the App Router's
    // default post-navigation behaviour (scroll-to-top, and moving focus to
    // the new content, its accessibility parity with a full page load) from
    // firing at all here. The effect above is the second half: it wins
    // focus back even if the re-render itself replaces the clicked button's
    // DOM node, which `scroll: false` alone does not cover.
    router.push(sortHref(accountId, { key: sort, dir }, key, q), { scroll: false });
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const rowIds = rows.map((r) => r.id);
  const selectionState = pageSelectionState(selected, rowIds);

  return (
    <ListPanel>
      <BulkActionBar
        accountId={accountId}
        selectedIds={[...selected]}
        existingTags={existingTags}
        onDone={() => setSelected(new Set())}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={selectionState === "all" ? true : selectionState === "some" ? "indeterminate" : false}
                onCheckedChange={() => setSelected((s) => togglePageSelection(s, rowIds))}
                aria-label={m["bulk.selectPage"]}
              />
            </TableHead>
            <TableHead aria-sort={sort === "name" ? (dir === "asc" ? "ascending" : "descending") : "none"}>
              <SortButton
                sortKey="name"
                label={m["contacts.col.name"]}
                active={sort === "name"}
                dir={dir}
                onClick={() => toggleSort("name")}
              />
            </TableHead>
            <TableHead>{m["contacts.col.phone"]}</TableHead>
            <TableHead>{m["contacts.col.email"]}</TableHead>
            <TableHead aria-sort={sort === "company" ? (dir === "asc" ? "ascending" : "descending") : "none"}>
              <SortButton
                sortKey="company"
                label={m["contacts.col.company"]}
                active={sort === "company"}
                dir={dir}
                onClick={() => toggleSort("company")}
              />
            </TableHead>
            <TableHead aria-sort={sort === "created" ? (dir === "asc" ? "ascending" : "descending") : "none"}>
              <SortButton
                sortKey="created"
                label={m["contacts.col.created"]}
                active={sort === "created"}
                dir={dir}
                onClick={() => toggleSort("created")}
              />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => {
            const name = contactDisplayName(c);
            return (
              <TableRow
                key={c.id}
                tabIndex={0}
                data-contact-row={c.id}
                aria-label={name}
                onClick={() => open(c.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return; // typing in a child — not row nav
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(c.id); }
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const sibling = e.key === "ArrowDown"
                      ? e.currentTarget.nextElementSibling
                      : e.currentTarget.previousElementSibling;
                    if (sibling instanceof HTMLElement) sibling.focus();
                  }
                }}
                className="cursor-pointer focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none"
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(c.id)}
                    onCheckedChange={() => toggleRow(c.id)}
                    aria-label={name}
                  />
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2 font-medium">
                    <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">
                      {initials(name)}
                    </span>
                    <span className="truncate">{name}</span>
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {c.phone ? (
                    <span className="flex items-center gap-1.5">
                      <Phone className="size-3.5" aria-hidden />
                      {c.phone}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {c.email ? (
                    <span className="flex items-center gap-1.5">
                      <Mail className="size-3.5" aria-hidden />
                      <span className="truncate">{c.email}</span>
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground">{c.company_name}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(c.created_at)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <ContactDrawer
        accountId={accountId}
        row={rows.find((r) => r.id === peekId) ?? (peekId ? missingRow(peekId) : null)}
        onClose={close}
      />
    </ListPanel>
  );
}

function SortButton({ sortKey, label, active, dir, onClick }: {
  sortKey: SortKey; label: string; active: boolean; dir: SortDir; onClick: () => void;
}) {
  // A neutral glyph until a column is actually driving the order, then the
  // direction it is actually in — `aria-sort` on the enclosing `<th>` is the
  // real accessible signal; this is sighted-user affordance on top of it.
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button
      type="button"
      // Looked up by the focus-restoration effect above after a sort click's
      // navigation lands — never read here, only written for that query.
      data-sort-key={sortKey}
      onClick={onClick}
      className="flex items-center gap-1 font-medium hover:text-foreground"
    >
      {label}
      <Icon className="size-3" aria-hidden />
    </button>
  );
}
