import Link from "next/link";
import { ArrowLeft, ArrowRight, Download, Upload, Users } from "lucide-react";
import { countContacts, listContacts, listTags } from "@bis/db";
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

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ q?: string; before?: string }>;
}) {
  const { accountId } = await params;
  const { q, before } = await searchParams;
  const db = await dbForRequest();

  // Validated once, reused twice: as the query's own cursor below, and as the
  // signal that decides which empty state a zero-row result means (see the
  // render below). `?before=` is a hand-editable URL parameter, so anything
  // unparseable must read as "no cursor" (cold start) rather than a thrown
  // error or a silent trip back to page one on every request.
  const cursor = parseCursor(before);

  const [rows, total, tags] = await Promise.all([
    listContacts(db, accountId, { search: q, limit: PAGE_SIZE + 1, before: cursor }),
    countContacts(db, accountId, { search: q }),
    listTags(db, accountId),
  ]);
  const base = `/dashboard/accounts/${accountId}/contacts`;
  const boundCreateContact = createContactAction.bind(null, accountId);

  const hasOlder = rows.length > PAGE_SIZE;
  const page = hasOlder ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  // CALLERS MUST BUILD THE QUERY STRING WITH `URLSearchParams`, never by
  // concatenation — the cursor's timestamp ends in "+00:00", and a raw "+" in
  // a query string decodes to a SPACE, which fails validation and silently
  // sends the user back to page one forever.
  const olderHref = hasOlder && last
    ? `?${new URLSearchParams({ ...(q ? { q } : {}),
        before: encodeCursor({ at: last.created_at, id: last.id }) })}`
    : null;
  // "Newer" returns to the unpaged head; a full back-stack is not worth the
  // state for a list an operator scans rather than browses.
  const newerHref = cursor ? `?${new URLSearchParams(q ? { q } : {})}` : null;

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
            <ContactsTable rows={page} accountId={accountId} existingTags={tags} />
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
