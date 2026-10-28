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
import { contactDisplayName, formatDateInZone, initials } from "@/lib/format";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { useLocale } from "@/components/locale-provider";
import { usePeek } from "@/lib/contacts/use-peek";
import { pageSelectionState, togglePageSelection } from "@/lib/contacts/selection";
import { focusAfterBar, nextRowId } from "@/lib/contacts/drawer-focus";
import { withWho, type Who } from "@/lib/assign/who";
import { withView, type ContactsView } from "@/lib/contacts/view";
import type { AssignMember } from "@/lib/assign/view";
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
  /** Contact archive (0103): set on a row of the Archived view; the drawer shows Restore and the archived line. */
  archived_at?: string | null;
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
 * The row the drawer shows for `peekId` (Task 7 fix round 1, I2): the row on
 * this page if it is here; else the last row this table saw for the same id
 * (`remembered`), because assigning from the drawer inside ?who=mine or
 * ?who=unassigned moves the customer out of the filtered list and the
 * revalidated page no longer carries their row, while the drawer, its toast
 * and the toast's Undo are still open on them; else the blank stub a deep
 * link to an id not on this page has always got. Keeping the drawer open was
 * chosen over closing it: the person sees the change they just made, where
 * they made it, and can keep working on the customer or undo.
 */
export function peekRow(rows: ContactRow[], peekId: string | null, remembered: ContactRow | null): ContactRow | null {
  if (!peekId) return null;
  return rows.find((r) => r.id === peekId)
    ?? (remembered?.id === peekId ? remembered : missingRow(peekId));
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
  accountId: string, current: { key: SortKey; dir: SortDir }, key: SortKey, q?: string, who: Who = "all",
  view: ContactsView = "active",
): string {
  const dir: SortDir = current.key === key && current.dir === "asc" ? "desc" : "asc";
  // `who` (Mine / Unassigned) rides along too: re-sorting Mine stays in Mine. So does the view
  // (contact archive): re-sorting the Archived view stays in it.
  const params = new URLSearchParams(withView(withWho({ ...(q ? { q } : {}), sort: key, dir }, who), view));
  return `/dashboard/accounts/${accountId}/contacts?${params}`;
}

export function ContactsTable({
  rows,
  accountId,
  existingTags,
  sort,
  dir,
  q,
  timezone,
  canDelete,
  who = "all",
  canAssign = false,
  members = [],
  viewerId = null,
  view = "active",
  canArchive = false,
  paused = false,
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
  /** The account's RESOLVED zone (`renderZone`, total by construction) —
   *  D-010: "Created" used to print in the RUNTIME's zone (server or
   *  browser), never the account's, same bug the activity timeline had. */
  timezone: string;
  /** Staff and roles: true for the agency and a client Owner, false for
   *  Staff — threaded straight through to BulkActionBar's own prop of the
   *  same name, which is what actually hides the Delete control. Tag
   *  actions stay available either way (DESIGN.md rule 4: checkboxes never
   *  render without a bulk-action bar). */
  canDelete: boolean;
  /** F-085 part 1: the Mine / Unassigned filter the page applied, carried
   *  into a re-sort's href like `q`. */
  who?: Who;
  /** F-085 part 1: may this caller assign customers (Owner, Staff, the
   *  agency), and to whom: the bulk bar's "Assign to…" and the drawer's
   *  "Assigned to" picker. False (the default) is read-only. */
  canAssign?: boolean;
  members?: AssignMember[];
  /** The viewer's own person here (readPersonId), for the drawer's "You". */
  viewerId?: string | null;
  /** Contact archive (plan Task 10): the list or its Archived view, carried into a re-sort's href and
   *  handed to the bulk bar (Archive on the list, Restore on the Archived view). */
  view?: ContactsView;
  /** Owners, Staff and the agency archive and restore (seesWholeAccount); false (the default) never. */
  canArchive?: boolean;
  /** The account is paused (billingVerdictFor): both delete dialogs keep Delete off (final review M3). */
  paused?: boolean;
}) {
  const router = useRouter();
  // F-085 follow-up (Task B): the page wraps this table in a LocaleProvider
  // seeded from requestLocale (page.tsx); the bulk-action bar and the
  // assignee fields already read this same context — the header/row copy
  // below joins them instead of staying hard-coded English.
  const locale = useLocale();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { peekId, open, close } = usePeek();
  // The last row seen for the open peek (fix round 1, I2: see peekRow).
  // Stored during render, React's "information from previous renders"
  // pattern: it only changes when the found row does, so it settles at once.
  const [remembered, setRemembered] = useState<ContactRow | null>(null);
  const found = peekId ? rows.find((r) => r.id === peekId) : undefined;
  if (found && found !== remembered) setRemembered(found);
  // The row focus goes to when the drawer closed because its contact left the list (final review M5).
  const [afterGone, setAfterGone] = useState<string | null>(null);
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
    router.push(sortHref(accountId, { key: sort, dir }, key, q, who, view), { scroll: false });
  }

  // Final review M5: Archive, Restore, Delete, a tag or Clear selection empty the selection, and the bar (with the
  // button that had focus) unmounts; focus moves to the select-all box once the bar has gone.
  function clearSelection() {
    setSelected(new Set());
    requestAnimationFrame(() => focusAfterBar());
  }

  // The drawer's own Archive, Restore or Delete: its contact leaves the list, so the drawer gives focus to the
  // row after it (or before it, for the last row) rather than to a row that is about to go.
  function drawerGone() {
    if (peekId) setAfterGone(nextRowId(rowIds, peekId));
    close();
  }

  function openRow(id: string) {
    setAfterGone(null);
    open(id);
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
        canDelete={canDelete}
        onDone={clearSelection}
        canAssign={canAssign}
        members={members}
        view={view}
        canArchive={canArchive}
        timezone={timezone}
        paused={paused}
      />
      <Table data-contacts-table tabIndex={-1} className="focus-visible:outline-none">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={selectionState === "all" ? true : selectionState === "some" ? "indeterminate" : false}
                onCheckedChange={() => setSelected((s) => togglePageSelection(s, rowIds))}
                data-select-page
                aria-label={t(m, "bulk.selectPage", locale)}
              />
            </TableHead>
            <TableHead aria-sort={sort === "name" ? (dir === "asc" ? "ascending" : "descending") : "none"}>
              <SortButton
                sortKey="name"
                label={t(m, "contacts.col.name", locale)}
                active={sort === "name"}
                dir={dir}
                onClick={() => toggleSort("name")}
              />
            </TableHead>
            <TableHead>{t(m, "contacts.col.phone", locale)}</TableHead>
            <TableHead>{t(m, "contacts.col.email", locale)}</TableHead>
            <TableHead aria-sort={sort === "company" ? (dir === "asc" ? "ascending" : "descending") : "none"}>
              <SortButton
                sortKey="company"
                label={t(m, "contacts.col.company", locale)}
                active={sort === "company"}
                dir={dir}
                onClick={() => toggleSort("company")}
              />
            </TableHead>
            <TableHead aria-sort={sort === "created" ? (dir === "asc" ? "ascending" : "descending") : "none"}>
              <SortButton
                sortKey="created"
                label={t(m, "contacts.col.created", locale)}
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
                onClick={() => openRow(c.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return; // typing in a child — not row nav
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRow(c.id); }
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
                <TableCell className="text-muted-foreground">{formatDateInZone(c.created_at, timezone, locale)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <ContactDrawer
        accountId={accountId}
        row={peekRow(rows, peekId, remembered)}
        onClose={close}
        // The remembered row, not peekId: it outlives the close, and Radix
        // asks where focus goes only after the peek has gone (drawer-focus.ts).
        returnFocusRowId={afterGone ?? remembered?.id ?? null}
        onGone={drawerGone}
        canAssign={canAssign}
        members={members}
        viewerId={viewerId}
        // Contact archive (plan Task 11): the drawer's Archive / Restore and Delete…, the same rights as the bar.
        canArchive={canArchive}
        canDelete={canDelete}
        timezone={timezone}
        paused={paused}
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
