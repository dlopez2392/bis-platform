import Link from "next/link";
import { ArrowLeft, ArrowRight, Download, Upload, Users } from "lucide-react";
import { countContacts, listContacts, listTags, type SortKey, type SortDir } from "@bis/db";
import { createContactAction } from "./actions";
import { ContactsTable } from "./contacts-table";
import { AddContactDialog } from "./add-contact-dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { dbForRequest } from "@/lib/db";
import { encodeCursor, parseCursor } from "@/lib/cursor";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

// One more row than a page shows, so a full page back is the only signal
// needed to decide whether an "Older" link is warranted — listContacts
// returns rows, not a total, and countContacts (below) answers a different
// question (how many match overall, not whether more exist past this batch).
const PAGE_SIZE = 50;

const SORT_KEYS: readonly SortKey[] = ["name", "company", "created"];
const SORT_DIRS: readonly SortDir[] = ["asc", "desc"];

/**
 * `?sort=`/`?dir=` are hand-editable URL parameters exactly like `?before=`
 * (parseCursor's own doc comment) — anything outside the three keys or two
 * directions falls back to the default rather than throwing, and a
 * duplicated query key producing an array at runtime (Next.js's actual
 * `searchParams` type, whatever a page's own annotation says) must not
 * throw either.
 */
function parseSort(raw: string | undefined): SortKey {
  return typeof raw === "string" && (SORT_KEYS as readonly string[]).includes(raw)
    ? (raw as SortKey) : "created";
}
function parseDir(raw: string | undefined): SortDir {
  return typeof raw === "string" && (SORT_DIRS as readonly string[]).includes(raw)
    ? (raw as SortDir) : "desc";
}

/** Whichever column `sort` actually ordered by, straight off a returned row —
 *  what the next page's cursor is built from. Must agree with
 *  packages/db/src/contacts.ts's own SORT_COLUMN mapping (name → sort_name,
 *  company → company_name, created → created_at) — that file selects
 *  `sort_name` on every row for exactly this caller. */
function cursorValue(
  sort: SortKey, row: { sort_name: string | null; company_name: string | null; created_at: string },
): string | null {
  return sort === "name" ? row.sort_name : sort === "company" ? row.company_name : row.created_at;
}

/**
 * The relative href for the "Newer" link: back to the unpaged head of the
 * CURRENT sort/search, dropping the cursor entirely — a full back-stack
 * isn't worth the state for a list an operator scans rather than browses.
 * Only rendered when `hasCursor` (there is somewhere newer to return to).
 *
 * Extracted as a pure, exported function — same reason contacts-table.tsx
 * exports `sortHref` — so "the Newer link carries the current sort/dir" is
 * a claim a test can execute, not just read off the source. CALLERS MUST
 * BUILD THE QUERY STRING WITH `URLSearchParams`, never by concatenation —
 * see this file's own comment where this used to be inlined.
 */
export function buildNewerHref(
  hasCursor: boolean, q: string | undefined, sort: SortKey, dir: SortDir,
): string | null {
  return hasCursor ? `?${new URLSearchParams({ ...(q ? { q } : {}), sort, dir })}` : null;
}

/**
 * The relative href for the "Older" link: same search/sort, cursor advanced
 * past `lastRow` (the last row of THIS page, already sliced to PAGE_SIZE).
 * `hasOlder` and `lastRow` are asked for separately, matching the exact
 * condition this replaces (`hasOlder && last`) rather than inferring one
 * from the other — `hasOlder` is only ever false when the query returned no
 * extra row, and `lastRow` is only ever absent for an empty page.
 */
export function buildOlderHref(
  hasOlder: boolean,
  lastRow: { sort_name: string | null; company_name: string | null; created_at: string; id: string } | undefined,
  q: string | undefined, sort: SortKey, dir: SortDir,
): string | null {
  if (!hasOlder || !lastRow) return null;
  return `?${new URLSearchParams({ ...(q ? { q } : {}), sort, dir,
      before: encodeCursor({ v: cursorValue(sort, lastRow), id: lastRow.id }) })}`;
}

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ q?: string; before?: string; sort?: string; dir?: string }>;
}) {
  const { accountId } = await params;
  const { q, before, sort: rawSort, dir: rawDir } = await searchParams;
  const db = await dbForRequest();

  // Validated once, reused twice: as the query's own cursor below, and as the
  // signal that decides which empty state a zero-row result means (see the
  // render below). `?before=` is a hand-editable URL parameter, so anything
  // unparseable must read as "no cursor" (cold start) rather than a thrown
  // error or a silent trip back to page one on every request.
  const cursor = parseCursor(before);
  const sort = parseSort(rawSort);
  const dir = parseDir(rawDir);

  const [rows, total, tags] = await Promise.all([
    listContacts(db, accountId, { search: q, limit: PAGE_SIZE + 1, before: cursor, sort: { key: sort, dir } }),
    countContacts(db, accountId, { search: q }),
    listTags(db, accountId),
  ]);
  const base = `/dashboard/accounts/${accountId}/contacts`;
  const boundCreateContact = createContactAction.bind(null, accountId);

  const hasOlder = rows.length > PAGE_SIZE;
  const page = hasOlder ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  // `sort`/`dir` are carried along on BOTH links (inside buildNewerHref /
  // buildOlderHref): a client scanning newest calls first, say, must not
  // have "Older" silently drop back to the default order.
  const olderHref = buildOlderHref(hasOlder, last, q, sort, dir);
  const newerHref = buildNewerHref(!!cursor, q, sort, dir);

  // A whole-phrase pick by count, never a plural template reused for one —
  // see contacts.count's own comment in messages.ts for the bug this avoids.
  const countLabel = total === 1
    ? m["contacts.countOne"]
    : m["contacts.count"].replace("{count}", String(total));

  return (
    <>
      <PageHeader
        title={m["contacts.title"]}
        count={countLabel}
        actions={
          <>
            <Link
              href={`${base}/export`}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              <Download className="size-4" aria-hidden />
              {m["contacts.export"]}
            </Link>
            <Link
              href={`${base}/import`}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              <Upload className="size-4" aria-hidden />
              {m["contacts.import"]}
            </Link>
            <AddContactDialog action={boundCreateContact} />
          </>
        }
        search={
          <form action={base}>
            <Input
              name="q"
              defaultValue={q ?? ""}
              placeholder={m["contacts.search"]}
              className="w-72"
            />
          </form>
        }
      />
      <div className="p-6">
        {page.length === 0 && !cursor ? (
          // The COLD-START reading of zero rows: no `?before=` cursor, so this
          // is page one and there is nothing behind it either. A cursored
          // zero (below) means the opposite: real history, just none older
          // than the cursor — the table still renders (headers, no rows) with
          // a "Newer" link back to the head, rather than this empty state.
          <EmptyState
            icon={Users}
            title={q ? m["contacts.noMatches.title"] : m["contacts.empty.title"]}
            body={q ? m["contacts.noMatches.body"] : m["contacts.empty.body"]}
          />
        ) : (
          <>
            <ContactsTable rows={page} accountId={accountId} existingTags={tags} sort={sort} dir={dir} q={q} />
            {newerHref || olderHref ? (
              <div className="mt-4 flex items-center justify-between">
                <div>
                  {newerHref ? (
                    <Link
                      href={newerHref}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      <ArrowLeft className="size-3.5" aria-hidden />
                      {m["contacts.newer"]}
                    </Link>
                  ) : null}
                </div>
                <div>
                  {olderHref ? (
                    <Link
                      href={olderHref}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      {m["contacts.older"]}
                      <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
