"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, Mail, Phone } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
// page of the client-side paging) still opens the drawer — the stub's empty
// fields render as empty InlineFields and the summary fetch 404s into the
// drawer's error state, which is exactly the spec's deleted-contact behavior.
function missingRow(id: string): ContactRow {
  return {
    id, first_name: null, last_name: null, email: null, phone: null,
    company_name: null, created_at: "",
  };
}

type SortKey = "name" | "company" | "created";

const PAGE_SIZE = 20;

export function ContactsTable({
  rows,
  accountId,
  existingTags,
}: {
  rows: ContactRow[];
  accountId: string;
  existingTags: { id: string; name: string }[];
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "created", dir: -1 });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { peekId, open, close } = usePeek();

  const sorted = useMemo(() => {
    const value = (r: ContactRow) =>
      sort.key === "name"
        ? contactDisplayName(r).toLowerCase()
        : sort.key === "company"
          ? (r.company_name ?? "").toLowerCase()
          : r.created_at;
    return [...rows].sort((a, b) => (value(a) < value(b) ? -sort.dir : value(a) > value(b) ? sort.dir : 0));
  }, [rows, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = sorted.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card">
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
                checked={pageSelectionState(selected, visible.map((r) => r.id)) === "all"
                  ? true
                  : pageSelectionState(selected, visible.map((r) => r.id)) === "some"
                    ? "indeterminate"
                    : false}
                onCheckedChange={() => setSelected((s) => togglePageSelection(s, visible.map((r) => r.id)))}
                aria-label={m["bulk.selectPage"]}
              />
            </TableHead>
            <TableHead>
              <SortButton label={m["contacts.col.name"]} onClick={() => toggleSort("name")} />
            </TableHead>
            <TableHead>{m["contacts.col.phone"]}</TableHead>
            <TableHead>{m["contacts.col.email"]}</TableHead>
            <TableHead>
              <SortButton label={m["contacts.col.company"]} onClick={() => toggleSort("company")} />
            </TableHead>
            <TableHead>
              <SortButton label={m["contacts.col.created"]} onClick={() => toggleSort("created")} />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((c) => {
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
      <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
        <span>
          {m["contacts.page"]
            .replace("{current}", String(current + 1))
            .replace("{total}", String(pageCount))}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            {m["common.prev"]}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
          >
            {m["common.next"]}
          </Button>
        </div>
      </div>
      <ContactDrawer
        accountId={accountId}
        row={rows.find((r) => r.id === peekId) ?? (peekId ? missingRow(peekId) : null)}
        onClose={close}
      />
    </div>
  );
}

function SortButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 font-medium hover:text-foreground"
    >
      {label}
      <ArrowUpDown className="size-3" aria-hidden />
    </button>
  );
}
