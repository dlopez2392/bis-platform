import { listContacts, type SortKey, type SortDir } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

// Column order is the IMPORT CONTRACT (Task 6 maps against it verbatim) —
// never reorder without updating that side too.
export const CSV_COLUMNS = ["first_name", "last_name", "email", "phone",
  "company_name", "source", "tags"] as const;

/** A cell starting with = + - or @ is a formula to Excel and Sheets, so a
 *  contact named "=HYPERLINK(...)" becomes code on the client's machine when
 *  they open our export. Prefixing a single quote is the standard defence and
 *  is stripped again on import. */
function guard(v: string): string {
  return /^[=+\-@]/.test(v) ? `'${v}` : v;
}

function cell(v: unknown): string {
  const s = guard(v == null ? "" : String(v));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  return [CSV_COLUMNS.join(","),
    ...rows.map((r) => CSV_COLUMNS.map((c) => cell(r[c])).join(","))].join("\n");
}

/**
 * The same per-row line toCsv builds, without its header. The streaming GET
 * below emits the header exactly once and then one chunk of rows at a time
 * — calling toCsv() per chunk would repeat the header on every chunk after
 * the first. Kept as a literal duplicate of toCsv's one mapping line rather
 * than refactoring toCsv itself, which is transcribed verbatim from the task
 * brief and is the exact contract Task 6's round-trip test depends on.
 */
function rowLines(rows: Record<string, unknown>[]): string {
  return rows.map((r) => CSV_COLUMNS.map((c) => cell(r[c])).join(",")).join("\n");
}

const SORT_KEYS: readonly SortKey[] = ["name", "company", "created"];
const SORT_DIRS: readonly SortDir[] = ["asc", "desc"];

// Mirrors the contacts list page's own parseSort/parseDir (page.tsx — not
// exported from there, so re-declared here rather than imported) with the
// SAME defaulting rule: this route's whole point is "export what I'm
// looking at", so a missing or hand-edited ?sort=/?dir= must fall back to
// exactly the default the list page renders, never throw.
function parseSort(raw: string | null): SortKey {
  return raw !== null && (SORT_KEYS as readonly string[]).includes(raw) ? (raw as SortKey) : "created";
}
function parseDir(raw: string | null): SortDir {
  return raw !== null && (SORT_DIRS as readonly string[]).includes(raw) ? (raw as SortDir) : "desc";
}

/** Whichever column `sort` actually ordered by, off a returned row — what
 *  the NEXT chunk's cursor is built from. Must agree with
 *  packages/db/src/contacts.ts's own SORT_COLUMN mapping (name → sort_name,
 *  company → company_name, created → created_at) and with the contacts
 *  page's own (unexported) cursorValue twin. */
function cursorValue(
  sort: SortKey, row: { sort_name: string | null; company_name: string | null; created_at: string },
): string | null {
  return sort === "name" ? row.sort_name : sort === "company" ? row.company_name : row.created_at;
}

// Pages the WHOLE matching set out of listContacts while exporting —
// independent of the contacts page's own PAGE_SIZE (50), which bounds one
// screen rather than a file that can hold thousands of rows. 500 keeps each
// query cheap while keeping the total query count small for a large account.
const CHUNK_SIZE = 500;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await params;
  // Same access check as every other route under this account's contacts
  // (layout.tsx, actions.ts) — NOT the /api folder's apiAccountAccess: this
  // route is reached by a real browser navigation (the contacts page's
  // Download link is a plain <Link>, not a fetch), so redirecting on
  // refusal behaves exactly like every other page in this account subtree.
  // A client asking for another account's export lands on their OWN
  // account's dashboard rather than learning whether the requested account
  // exists (requireAccountAccess's own doc comment).
  await requireAccountAccess(accountId);

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const sort = parseSort(url.searchParams.get("sort"));
  const dir = parseDir(url.searchParams.get("dir"));

  const db = await dbForRequest(); // RLS-scoped — NEVER serviceDb here

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(CSV_COLUMNS.join(",")));
        let cursor: { v: string | null; id: string } | undefined;
        for (;;) {
          const chunk = await listContacts(db, accountId,
            { search: q, limit: CHUNK_SIZE, before: cursor, sort: { key: sort, dir } });
          if (chunk.length === 0) break;
          // No bulk "tags for many contacts" read exists today — only
          // listContactTags, one contact at a time (see this task's
          // report). An empty column here over an N+1 query per row.
          const withTags = chunk.map((r: Record<string, unknown>) => ({ ...r, tags: "" }));
          controller.enqueue(encoder.encode("\n" + rowLines(withTags)));
          // Fewer rows than asked for means this was the last page — skips
          // one wasted trailing query in the common case. The one edge case
          // this doesn't catch (a total that's an exact multiple of
          // CHUNK_SIZE) costs a single harmless empty extra query, not a
          // correctness problem.
          if (chunk.length < CHUNK_SIZE) break;
          const last = chunk[chunk.length - 1];
          cursor = { v: cursorValue(sort, last), id: last.id };
        }
      } catch (err) {
        // No swallow: a mid-stream failure aborts the download rather than
        // silently completing a truncated file the client would trust.
        controller.error(err);
        return;
      }
      controller.close();
    },
  });

  // UTC, deliberately: this is a cosmetic export timestamp in a filename,
  // not a business date tied to the account's own timezone — contrast the
  // Intl-in-the-server's-zone trap this codebase has hit before on values
  // that DO need to match the account's local calendar day.
  const date = new Date().toISOString().slice(0, 10);
  const filename = m["contacts.export.filename"].replace("{date}", date);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
