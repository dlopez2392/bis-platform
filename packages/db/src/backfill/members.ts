import { roleFromClerk, isAgencyMetadata, languageFromClerk, type AccountRole, type PersonLanguage } from "../team";

/**
 * Staff and roles (plan deviation 3): the backfill planner and SQL emitter
 * for every existing client login. Pure — it connects to no database. The
 * orchestrator reads `accounts.json` (`select id, clerk_org_id from
 * accounts`, via execute_sql) and `members-run.ts` reads Clerk's CURRENT
 * membership list for each org; this module turns that into the rows the
 * seed SQL writes and the one SQL statement per row the orchestrator runs
 * through the Supabase MCP.
 *
 * Uses the SAME rule the webhook and the fallback use (team.ts's
 * roleFromClerk/isAgencyMetadata), so a login backfilled here and one
 * synced live land on the identical role for the identical Clerk state.
 */
export type BackfillAccount = { id: string; clerk_org_id: string };

/** One Clerk organisation membership, already flattened: the membership's
 *  own role and metadata, plus the named user's email, name and metadata
 *  (members-run.ts's two Clerk reads, combined). */
export type ClerkOrgMember = {
  clerkUserId: string;
  email: string | null;
  name: string | null;
  clerkRole: string;
  membershipMeta: unknown;
  userMeta: unknown;
};

export type BackfillRow = {
  accountId: string;
  clerkUserId: string;
  email: string;
  name: string | null;
  role: AccountRole;
  language: PersonLanguage | null;
};

/**
 * Turns every account's current Clerk membership list into the rows the
 * emitted SQL will seed. Skips, counted but never written:
 *   - an agency user (`isAgencyMetadata`, plan deviation 6) — the agency
 *     admin who created a client org via `createClientAccount` is an
 *     `org:admin` member of it and would otherwise become its Owner;
 *   - a member Clerk reports with no email — `users.email` is NOT NULL.
 */
export function planMemberBackfill(
  accounts: readonly BackfillAccount[],
  membersByOrg: Record<string, readonly ClerkOrgMember[]>,
): { rows: BackfillRow[]; skippedAgency: number; skippedNoEmail: number } {
  const rows: BackfillRow[] = [];
  let skippedAgency = 0;
  let skippedNoEmail = 0;
  for (const account of accounts) {
    const members = membersByOrg[account.clerk_org_id] ?? [];
    for (const m of members) {
      if (isAgencyMetadata(m.userMeta)) {
        skippedAgency++;
        continue;
      }
      if (!m.email) {
        skippedNoEmail++;
        continue;
      }
      const role = roleFromClerk({ clerkRole: m.clerkRole, membershipMeta: m.membershipMeta });
      const language = languageFromClerk(m.membershipMeta);
      rows.push({ accountId: account.id, clerkUserId: m.clerkUserId, email: m.email, name: m.name, role, language });
    }
  }
  return { rows, skippedAgency, skippedNoEmail };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: readonly AccountRole[] = ["owner", "staff"];
const LANGS: readonly PersonLanguage[] = ["en", "es"];

/** Doubles every `'`; refuses a NUL byte (postgres text cannot hold one — the
 *  literal would silently truncate at it, not merely misquote). */
function sqlString(v: string): string {
  if (v.includes("\u0000")) throw new Error("memberBackfillSql: a value contains a NUL byte");
  return `'${v.split("'").join("''")}'`;
}

function sqlUuid(v: string, label: string): string {
  if (!UUID.test(v)) throw new Error(`memberBackfillSql: ${label} is not a uuid`);
  return `'${v}'::uuid`;
}

function sqlNullable(v: string | null): string {
  return v === null ? "null" : sqlString(v);
}

function oneStatement(r: BackfillRow, i: number): string {
  if (!ROLES.includes(r.role)) throw new Error(`memberBackfillSql: row ${i + 1} has an invalid role`);
  if (r.language !== null && !LANGS.includes(r.language)) throw new Error(`memberBackfillSql: row ${i + 1} has an invalid language`);
  if (!r.clerkUserId) throw new Error(`memberBackfillSql: row ${i + 1} has no clerkUserId`);
  if (!r.email) throw new Error(`memberBackfillSql: row ${i + 1} has no email`);
  return [
    "with u as (",
    `  insert into public.users (clerk_user_id, email, name, language) values (${sqlString(r.clerkUserId)}, ${sqlString(r.email)}, ${sqlNullable(r.name)}, ${sqlNullable(r.language)})`,
    "  on conflict (clerk_user_id) do update set email = excluded.email",
    "  returning id)",
    "insert into public.memberships (user_id, scope, account_id, role)",
    `select id, 'account', ${sqlUuid(r.accountId, `row ${i + 1}'s accountId`)}, ${sqlString(r.role)} from u`,
    "on conflict (account_id, user_id) do nothing;",
  ].join("\n");
}

/**
 * One idempotent statement per row (safe to run twice): upserts the person
 * by `clerk_user_id` (email always follows Clerk; `name`/`language` are
 * part of the same VALUES row, so a re-run with the same input writes the
 * same values — but the `on conflict` clause touches only `email`, so a
 * later real edit to name or language, by the webhook, the fallback or the
 * person themselves, is never clobbered by re-running this file), then
 * inserts the membership ONLY if the pair does not already exist yet. The
 * membership insert never updates on conflict, so an existing role — set by
 * the webhook, the fallback, or a person's own later change — is never
 * touched, let alone downgraded, by re-running this backfill.
 *
 * Every literal is emitted as a UTF-8 SQL literal with its quotes doubled,
 * through `sqlString`/`sqlUuid` (refuses a NUL); non-ASCII characters
 * pass through as UTF-8, not escaped. A backslash anywhere in the result throws rather than
 * emit it, because the Supabase MCP mangles backslash escapes (memory
 * bis-mcp-sql-escapes).
 */
export function memberBackfillSql(rows: readonly BackfillRow[]): string {
  if (rows.length === 0) throw new Error("memberBackfillSql: nothing to write");
  const sql = rows.map((r, i) => oneStatement(r, i)).join("\n\n") + "\n";
  if (sql.includes(String.fromCharCode(0x5c))) {
    throw new Error("memberBackfillSql: a value carries a backslash, which the MCP would mangle");
  }
  return sql;
}
