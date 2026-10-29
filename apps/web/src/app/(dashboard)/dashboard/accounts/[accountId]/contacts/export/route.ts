import { listContacts, listTagNamesForContacts, countContacts, type SortKey, type SortDir } from "@bis/db";
import { requireAccountOwner } from "@/lib/auth";
import { agencyVisitMissing } from "@/lib/access-log/gate";
import { noteOpenedApi } from "@/lib/access-log/note";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { archivedFilterOf, parseView } from "@/lib/contacts/view";

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

/** Review m5: the agency's visit ended. Plain text, never a redirect — a download link must not save
 *  the chooser's HTML as the file. */
function exportEnded(): Response {
  return new Response(m["accessLog.exportEnded"], {
    status: 409,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await params;
  // F-118 part 1 (plan C2): a Link's prefetch or RSC fetch of this URL must neither read nor log.
  if (req.headers.get("rsc") !== null || req.headers.get("next-router-prefetch") !== null) return new Response(null, { status: 204 });
  // Review m5: a download link must never save the chooser's HTML as the file. An agency person whose visit
  // ended is told so in plain text, BEFORE any guard can redirect.
  if (await agencyVisitMissing(accountId)) return exportEnded();

  // Staff and roles: export is Owner-only, so this is requireAccountOwner
  // — not the plain requireAccountAccess every other route under this
  // account's contacts (layout.tsx, actions.ts) uses — and NOT the /api
  // folder's apiAccountAccess: this route is reached by a real browser
  // navigation (the contacts page's Download link is a plain <Link>, not a
  // fetch), so redirecting on refusal behaves exactly like every other page
  // in this account subtree. A Staff caller — like a client asking for
  // another account's export — lands on their OWN account's dashboard
  // rather than a 403 confirming the export exists for this account at all
  // (requireAccountOwner's own doc comment). Staff can still READ contacts
  // (requireAccountAccess would let them through here), so this guard is a
  // friction control on the bulk-download path, not a data-visibility one.
  const access = await requireAccountOwner(accountId);

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const sort = parseSort(url.searchParams.get("sort"));
  const dir = parseDir(url.searchParams.get("dir"));
  // Contact archive (spec 4.1): the view the Export link was opened from. The list leaves archived
  // contacts out, like the screen; the Archived view exports only them.
  const archived = archivedFilterOf(parseView(url.searchParams.get("view")));

  const db = await dbForRequest(); // RLS-scoped — NEVER serviceDb here

  // F-118 part 1 (plan C1): the route streams, so the count of what it is about to send is read first, on the
  // export's own filters, and the download is logged before a single row leaves (owner ruling 4). Only the
  // agency is logged, so only the agency pays for the count: a client's export adds no query (spec 4.3).
  if (access.isAgency) {
    const total = await countContacts(db, accountId, { search: q, archived });
    if (!(await noteOpenedApi(access, accountId, { kind: "customer_list_export", itemCount: total }))) return exportEnded();
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // \uFEFF once, before anything else: the UTF-8 BOM Excel needs to
        // render á/ñ/é correctly when this file is double-clicked open
        // rather than pulled in through the text-import wizard — the
        // overwhelmingly likely path for a small-business "Export CSV"
        // button. NOT added inside toCsv() — that pure function is Task 6's
        // locked round-trip contract (see its own doc comment above) and
        // has no header-emission concept of its own to prefix.
        //
        // TASK 6 (the CSV importer) MUST explicitly strip a leading
        // \uFEFF from the parsed header before matching column names —
        // never assume the runtime already did it. Verified empirically in this
        // repo: Response.text()/Blob.text() (Fetch's UTF-8-decode
        // algorithm) DO strip it, but fs.readFileSync(path, "utf8") and
        // Buffer#toString("utf8") do NOT — the BOM survives as a literal
        // U+FEFF character. Whichever the importer reads with, an
        // unstripped BOM turns the first header into "\uFEFFfirst_name",
        // which matches no known column and silently drops that column's
        // data on re-import. Also: toCsv()'s own round-trip test (Task 6)
        // won't exercise this by construction, since toCsv() itself never
        // emits a BOM — the importer needs its OWN dedicated BOM test.
        controller.enqueue(encoder.encode("\uFEFF" + CSV_COLUMNS.join(",")));
        let cursor: { v: string | null; id: string } | undefined;
        for (;;) {
          const chunk = await listContacts(db, accountId,
            { search: q, limit: CHUNK_SIZE, before: cursor, sort: { key: sort, dir }, archived });
          if (chunk.length === 0) break;
          // D-008: the export's own "tags" column was always blank — this
          // used to read "no bulk 'tags for many contacts' read exists
          // today", so `listTagNamesForContacts` (packages/db/src/contacts.ts)
          // is ONE query per chunk, not an N+1 over listContactTags.
          const tagNames = await listTagNamesForContacts(
            db, accountId, chunk.map((r: Record<string, unknown>) => r.id as string));
          const withTags = chunk.map((r: Record<string, unknown>) => ({
            ...r, tags: tagNames.get(r.id as string) ?? "",
          }));
          controller.enqueue(encoder.encode("\n" + rowLines(withTags)));
          // Fewer rows than asked for means this was the last page — skips
          // one wasted trailing query in the common case. The one edge case
          // this doesn't catch (a total that's an exact multiple of
          // CHUNK_SIZE) costs a single harmless empty extra query, not a
          // correctness problem.
          if (chunk.length < CHUNK_SIZE) break;
          const last = chunk[chunk.length - 1];
          // noUncheckedIndexedAccess types this access as `... | undefined`
          // regardless of the length checks above — chunk.length >=
          // CHUNK_SIZE here so this is unreachable in practice, but a
          // non-null assertion would turn a wrong assumption into an
          // infinite loop (cursor.id stays undefined forever) or a crash
          // mid-download instead of a clean stop. Ending the export is the
          // only safe response to a chunk the code can't prove has a last
          // row, so treat it exactly like the already-handled empty chunk.
          if (!last) break;
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
