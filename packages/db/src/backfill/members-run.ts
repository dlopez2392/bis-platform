/**
 * pnpm --filter @bis/db backfill:members <accounts.json> --emit-sql <out.sql>
 *
 * <accounts.json> is the JSON array `execute_sql` returns for
 * `select id, clerk_org_id from accounts` (BackfillAccount[]), saved by the
 * orchestrator. For every account this reads its Clerk organisation's
 * CURRENT membership list (`GET /v1/organizations/{org}/memberships`, paged
 * 100 at a time) and the named users' email, name and public_metadata
 * (`GET /v1/users`, batched 100 ids at a time), runs planMemberBackfill —
 * the SAME rule the webhook and the fallback use (team.ts's
 * roleFromClerk/isAgencyMetadata) — and writes the idempotent seed SQL to
 * <out.sql> for the orchestrator to run through the Supabase MCP.
 *
 * Reads CLERK_SECRET_KEY for presence only; never prints it, never parses
 * an env file. Connects to no database — every write is to <out.sql>.
 *
 * Prints counts only: accounts read, rows per role, skipped agency, skipped
 * no-email — never an email, a name or a Clerk id. Any error (a missing
 * key, a bad accounts file, a Clerk 4xx/5xx) is caught and only its message
 * is printed (the telnyx-optouts-run precedent, I1).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { planMemberBackfill, memberBackfillSql, type BackfillAccount, type ClerkOrgMember } from "./members";

const CLERK_API = "https://api.clerk.com/v1";
const PAGE_SIZE = 100;
const USER_BATCH = 100;

type ClerkMembership = {
  role: string;
  public_metadata?: unknown;
  public_user_data?: { user_id?: string } | null;
};
type ClerkUser = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  public_metadata?: unknown;
  email_addresses?: { id: string; email_address: string }[];
  primary_email_address_id?: string | null;
};

function requireClerkKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("CLERK_SECRET_KEY is not set");
  return key;
}

async function clerkGet(key: string, path: string): Promise<unknown> {
  const res = await fetch(`${CLERK_API}${path}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Clerk request failed: ${res.status} ${res.statusText}`);
  return res.json();
}

/** Pages until a page returns fewer than PAGE_SIZE rows. */
async function fetchOrgMemberships(key: string, orgId: string): Promise<ClerkMembership[]> {
  const out: ClerkMembership[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await clerkGet(key, `/organizations/${encodeURIComponent(orgId)}/memberships?limit=${PAGE_SIZE}&offset=${offset}`);
    const data = Array.isArray((page as { data?: unknown }).data) ? (page as { data: ClerkMembership[] }).data : [];
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}

function userName(u: ClerkUser): string | null {
  const parts = [u.first_name, u.last_name].filter((s): s is string => typeof s === "string" && s.length > 0);
  return parts.length > 0 ? parts.join(" ") : null;
}

function userEmail(u: ClerkUser): string | null {
  const list = u.email_addresses ?? [];
  const primary = list.find((e) => e.id === u.primary_email_address_id);
  return (primary ?? list[0])?.email_address ?? null;
}

/** GET /v1/users?user_id=...&user_id=... (repeated), batched 100 ids at a time. */
async function fetchUsersByIds(key: string, ids: readonly string[]): Promise<Map<string, ClerkUser>> {
  const byId = new Map<string, ClerkUser>();
  for (let i = 0; i < ids.length; i += USER_BATCH) {
    const batch = ids.slice(i, i + USER_BATCH);
    if (batch.length === 0) continue;
    const qs = batch.map((id) => `user_id=${encodeURIComponent(id)}`).join("&");
    const users = (await clerkGet(key, `/users?${qs}&limit=${USER_BATCH}`)) as ClerkUser[];
    for (const u of users) byId.set(u.id, u);
  }
  return byId;
}

function parseAccountsFile(text: string): BackfillAccount[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("accounts file: not valid JSON");
  }
  if (!Array.isArray(json)) throw new Error("accounts file: expected the JSON array execute_sql returned");
  return json as BackfillAccount[];
}

async function run(argv: string[]): Promise<void> {
  const [accountsPath, flag, outPath] = argv;
  if (!accountsPath || flag !== "--emit-sql" || !outPath) {
    throw new Error("usage: backfill:members <accounts.json> --emit-sql <out.sql>");
  }
  const key = requireClerkKey();
  const accounts = parseAccountsFile(readFileSync(accountsPath, "utf8"));

  const membershipsByOrg = new Map<string, ClerkMembership[]>();
  const allUserIds = new Set<string>();
  for (const account of accounts) {
    const memberships = await fetchOrgMemberships(key, account.clerk_org_id);
    membershipsByOrg.set(account.clerk_org_id, memberships);
    for (const m of memberships) {
      const uid = m.public_user_data?.user_id;
      if (uid) allUserIds.add(uid);
    }
  }
  const users = await fetchUsersByIds(key, [...allUserIds]);

  const membersByOrg: Record<string, ClerkOrgMember[]> = {};
  for (const account of accounts) {
    const memberships = membershipsByOrg.get(account.clerk_org_id) ?? [];
    membersByOrg[account.clerk_org_id] = memberships
      .map((m): ClerkOrgMember | null => {
        const uid = m.public_user_data?.user_id;
        if (!uid) return null;
        const user = users.get(uid);
        return {
          clerkUserId: uid,
          email: user ? userEmail(user) : null,
          name: user ? userName(user) : null,
          clerkRole: m.role,
          membershipMeta: m.public_metadata,
          userMeta: user?.public_metadata,
        };
      })
      .filter((m): m is ClerkOrgMember => m !== null);
  }

  const plan = planMemberBackfill(accounts, membersByOrg);
  console.log(`accounts read: ${accounts.length}`);
  const perRole = new Map<string, number>();
  for (const r of plan.rows) perRole.set(r.role, (perRole.get(r.role) ?? 0) + 1);
  for (const [role, n] of perRole) console.log(`rows, role ${role}: ${n}`);
  console.log(`rows total: ${plan.rows.length}`);
  console.log(`skipped (agency): ${plan.skippedAgency}`);
  console.log(`skipped (no email): ${plan.skippedNoEmail}`);

  if (plan.rows.length === 0) {
    console.log("nothing to write: no statement emitted");
    return;
  }
  writeFileSync(outPath, memberBackfillSql(plan.rows));
  console.log(`statement written to ${outPath}`);
}

run(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
