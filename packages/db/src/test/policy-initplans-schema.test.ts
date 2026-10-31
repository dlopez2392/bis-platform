import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback } from "./db";

/**
 * 0109 (F-092 scale follow-up, spec docs/superpowers/specs/2026-10-31-search-scale-design.md sections 2 and 4.1):
 * every policy that called a zero-argument helper once per row now calls it once per statement, as an InitPlan.
 *
 * PRE below is the text pg_policies held for the 64 policies before 0109, read off a PostgreSQL 17.6 replica of
 * 0001-0108 whose whole-policy digest (spec 2.1) was 4f4914fcd094dbb3f13894fa6e19b3f2, the value production and
 * bis-ci read on 2026-10-31. The expected text after 0109 is COMPUTED from PRE by one substitution, wrapCalls, so a
 * hand edit to either the migration or this table fails the first test.
 *
 * Red before 0109 is applied: the wrap test (all 64 differ) and the guard (it names the 64). Green before AND after,
 * by design, because they guard what 0109 must NOT change: the untouched 72, the totals and the detector's own controls.
 */

/** The three zero-argument STABLE helpers the 64 policies called per row (spec 2.4). */
const HELPERS = "is_agency|current_account_id|jwt";

/** PRE -> post-0109 text: each bare helper call becomes the InitPlan PostgreSQL deparses `(select app.f())` to. */
const wrapCalls = (s: string | null) =>
  s === null ? null : s.replace(new RegExp(`app\\.(${HELPERS})\\(\\)`, "g"), (_m, f: string) => `( SELECT app.${f}() AS ${f})`);
/** The normaliser in the other direction: every `( SELECT app.f() AS f)` back to `app.f()`. */
const unwrapCalls = (s: string | null) =>
  s === null ? null : s.replace(new RegExp(`\\( SELECT app\\.(${HELPERS})\\(\\) AS (\\w+)\\)`, "g"),
    (m, f: string, alias: string) => (alias === f ? `app.${f}()` : m));

const HOUSE = "(app.is_agency() OR (account_id = app.current_account_id()))";
const AGENCY = "app.is_agency()";
const AGENCY_NULLSAFE = "COALESCE(app.is_agency(), false)";
const ORG_MEMBER = "((clerk_org_id = (app.jwt() ->> 'org_id'::text)) AND client_access_enabled)";

/** [table, policy, command, USING, WITH CHECK] before 0109. Every one is PERMISSIVE and TO authenticated. */
type Pinned = readonly [table: string, policy: string, cmd: string, qual: string | null, withCheck: string | null];
const PRE: readonly Pinned[] = [
  ["account_ai_settings", "account_ai_settings_agency_read", "SELECT", AGENCY_NULLSAFE, null],
  ["account_billing", "account_billing_tenant", "SELECT", HOUSE, null],
  ["accounts", "accounts_agency_all", "ALL", AGENCY, AGENCY],
  ["accounts", "accounts_member_read", "SELECT", ORG_MEMBER, null],
  ["accounts", "accounts_member_update", "UPDATE", ORG_MEMBER, ORG_MEMBER],
  ["agencies", "agencies_agency_all", "ALL", AGENCY, AGENCY],
  ["ai_acts", "ai_acts_member_read", "SELECT", HOUSE, null],
  ["ai_gateway_settings", "ai_gateway_settings_agency_read", "SELECT", AGENCY_NULLSAFE, null],
  ["ai_ledger", "ai_ledger_agency_read", "SELECT", AGENCY_NULLSAFE, null],
  ["automation_log", "automation_log_tenant", "SELECT", HOUSE, null],
  ["automation_settings", "automation_settings_tenant", "SELECT", HOUSE, null],
  ["automations", "automations_tenant", "ALL", HOUSE, HOUSE],
  ["blueprints", "blueprints_agency_all", "ALL", AGENCY, AGENCY],
  ["bookings", "bookings_tenant_read", "SELECT", HOUSE, null],
  ["business_status", "business_status_member_read", "SELECT", HOUSE, null],
  ["calendars", "calendars_tenant", "ALL", HOUSE, HOUSE],
  ["calls", "calls_tenant", "ALL", HOUSE, HOUSE],
  ["checklist_items", "checklist_items_member_all", "ALL", HOUSE, HOUSE],
  ["client_group_members", "client_group_members_member_read", "SELECT", HOUSE, null],
  ["client_groups", "client_groups_member_read", "SELECT", HOUSE, null],
  ["closed_days", "closed_days_member_read", "SELECT", HOUSE, null],
  ["consent_events", "consent_events_read", "SELECT", HOUSE, null],
  ["contact_duplicate_flags", "contact_duplicate_flags_member_insert", "INSERT", null, HOUSE],
  ["contact_duplicate_flags", "contact_duplicate_flags_member_read", "SELECT", HOUSE, null],
  ["contact_relationships", "contact_relationships_member_all", "ALL", HOUSE, HOUSE],
  ["contact_tags", "contact_tags_member_all", "ALL", HOUSE, HOUSE],
  ["contacts", "contacts_member_all", "ALL", HOUSE, HOUSE],
  ["conversations", "conversations_member_read", "SELECT", HOUSE, null],
  ["custom_fields", "custom_fields_member_all", "ALL", HOUSE, HOUSE],
  ["custom_values", "custom_values_member_all", "ALL", HOUSE, HOUSE],
  ["document_requests", "document_requests_member_read", "SELECT", HOUSE, null],
  ["document_requirement_skips", "document_requirement_skips_member_read", "SELECT", HOUSE, null],
  ["document_shares", "document_shares_member_read", "SELECT", HOUSE, null],
  ["document_versions", "document_versions_member_read", "SELECT", HOUSE, null],
  ["documents", "documents_member_read", "SELECT", HOUSE, null],
  ["equipment", "equipment_member_all", "ALL", HOUSE, HOUSE],
  ["events", "events_read", "SELECT", HOUSE, null],
  ["form_submissions", "form_submissions_member_read", "SELECT", HOUSE, null],
  ["forms", "forms_member_all", "ALL", HOUSE, HOUSE],
  ["inbound_emails", "inbound_emails_member_read", "SELECT", HOUSE, null],
  ["inbound_never_log", "inbound_never_log_member_read", "SELECT", "(COALESCE(app.is_agency(), false) OR (account_id = app.current_account_id()))", null],
  ["memberships", "memberships_agency_read", "SELECT", AGENCY, null],
  ["memberships", "memberships_member_read", "SELECT", "(account_id = app.current_account_id())", null],
  ["messages", "messages_member_read", "SELECT", HOUSE, null],
  ["notes", "notes_member_all", "ALL", HOUSE, HOUSE],
  ["opportunities", "opportunities_member_all", "ALL", HOUSE, HOUSE],
  ["phone_numbers", "phone_numbers_tenant", "ALL", HOUSE, HOUSE],
  ["pipeline_stages", "pipeline_stages_member_all", "ALL", HOUSE, HOUSE],
  ["pipelines", "pipelines_member_all", "ALL", HOUSE, HOUSE],
  ["places", "places_member_all", "ALL", HOUSE, HOUSE],
  ["plans", "plans_agency_read", "SELECT", AGENCY, null],
  ["proposals", "proposals_member_read", "SELECT", HOUSE, null],
  ["record_summaries", "record_summaries_member_read", "SELECT", HOUSE, null],
  ["site_traffic_breakdown", "site_traffic_breakdown_tenant", "SELECT", HOUSE, null],
  ["site_traffic_daily", "site_traffic_daily_tenant", "SELECT", HOUSE, null],
  ["sites", "sites_tenant", "SELECT", HOUSE, null],
  ["tags", "tags_member_all", "ALL", HOUSE, HOUSE],
  ["tasks", "tasks_member_all", "ALL", HOUSE, HOUSE],
  ["usage_events", "usage_events_tenant", "SELECT", HOUSE, null],
  ["users", "users_agency_read", "SELECT", AGENCY, null],
  ["users", "users_member_read", "SELECT", "(EXISTS ( SELECT 1\n   FROM memberships m\n  WHERE ((m.user_id = users.id) AND (m.scope = 'account'::text) AND (m.account_id = app.current_account_id()))))", null],
  ["voice_knowledge_snapshots", "voice_knowledge_snapshots_member_read", "SELECT", HOUSE, null],
  ["voice_profiles", "voice_profiles_tenant", "ALL", HOUSE, HOUSE],
  ["voice_services", "voice_services_member_read", "SELECT", HOUSE, null],
];

/** The one policy that calls a helper per row and stays so (spec 2.4 item 4): its argument is a ROW column. */
const ALLOWED_PER_ROW: Record<string, string> = {
  inbound_never_log_no_technician: "app.sees_all_customers(account_id)",
};

/**
 * Every app.* or auth.* call in a policy expression that runs once per ROW. A call counts as once per statement
 * only inside a `( SELECT ...)` group that has no FROM and mentions no column: an uncorrelated scalar sub-select,
 * which PostgreSQL plans as an InitPlan. The column test is conservative: after string literals, casts, aliases,
 * helper names and a handful of keywords are removed, ANY word left makes the group count as correlated, so an
 * unknown shape is reported rather than excused.
 */
function perRowCalls(expr: string | null): string[] {
  if (!expr) return [];
  const close = (from: number) => {
    let d = 0;
    for (let j = from; j < expr.length; j++) {
      if (expr[j] === "(") d++;
      else if (expr[j] === ")" && --d === 0) return j;
    }
    return expr.length - 1;
  };
  const KEYWORDS = new Set(["SELECT", "COALESCE", "NULLIF", "true", "false", "NULL", "AND", "OR", "NOT", "IN", "IS", "ANY", "ARRAY"]);
  /** A helper call: app.* or auth.* (any name, digits included), or a direct read of the request's claims. */
  const CALL = /\b(?:(?:app|auth)\.[a-z0-9_]+|(?:pg_catalog\.)?current_setting)\(/g;
  const mentionsAColumn = (group: string) =>
    (group.replace(/'(?:[^']|'')*'/g, " ").replace(/::[a-z0-9_]+(\[\])?/g, " ").replace(/\bAS\s+("[^"]*"|\w+)/g, " ")
      .replace(CALL, "(").match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? []).some((w) => !KEYWORDS.has(w));
  const initplans: [number, number][] = [];
  for (let i = expr.indexOf("( SELECT "); i >= 0; i = expr.indexOf("( SELECT ", i + 1)) {
    const j = close(i), group = expr.slice(i, j + 1);
    if (!/\bFROM\b/.test(group) && !mentionsAColumn(group)) initplans.push([i, j]);
  }
  const out: string[] = [];
  for (const m of expr.matchAll(CALL)) {
    const open = m.index + m[0].length - 1, end = close(open), args = expr.slice(open + 1, end);
    // current_setting counts only when it reads the claims: current_setting('request.jwt...').
    if (/current_setting\($/.test(m[0]) && !args.startsWith("'request.jwt")) continue;
    if (!initplans.some(([a, b]) => a < m.index && end <= b)) out.push(`${m[0].slice(0, -1)}(${args})`);
  }
  return out;
}

type Live = { t: string; p: string; perm: string; roles: string; cmd: string; q: string | null; w: string | null };
const livePolicies = async (c: Client) =>
  (await c.query<Live>(`select tablename as t, policyname as p, permissive as perm, array_to_string(roles, ',') as roles,
      cmd, qual as q, with_check as w from pg_policies where schemaname = 'public' order by tablename, policyname`)).rows;

/** Every policy with a per-row call other than the allowed one, as "policy: call, call", one entry per policy. */
const offenders = (rows: Live[]) =>
  rows.flatMap((r) => {
    const calls = [...new Set([...perRowCalls(r.q), ...perRowCalls(r.w)])].filter((call) => ALLOWED_PER_ROW[r.p] !== call);
    return calls.length ? [`${r.p}: ${calls.join(", ")}`] : [];
  }).sort();

describe("0109: the 64 policies are wrapped and otherwise unchanged", () => {
  it("PRE holds 64 distinct policies on 59 tables (the spec's inventory, 2.2)", () => {
    expect(PRE).toHaveLength(64);
    expect(new Set(PRE.map((r) => r[1])).size).toBe(64);
    expect(new Set(PRE.map((r) => r[0])).size).toBe(59);
  });

  it("each is the pre-0109 text with exactly its helper calls wrapped, still PERMISSIVE, TO authenticated, same command (red before 0109: 64 differ; mutation: change one token outside a helper call -> FAILS naming the policy)", () =>
    withRollback(async (c) => {
      const live = new Map((await livePolicies(c)).map((r) => [r.p, r]));
      const actual = Object.fromEntries(PRE.map(([t, p]) => {
        const r = live.get(p);
        return [p, r ? { table: r.t, kind: r.perm, roles: r.roles, cmd: r.cmd, using: r.q, check: r.w } : "missing"];
      }));
      const expected = Object.fromEntries(PRE.map(([t, p, cmd, q, w]) =>
        [p, { table: t, kind: "PERMISSIVE", roles: "authenticated", cmd, using: wrapCalls(q), check: wrapCalls(w) }]));
      expect(actual).toEqual(expected);
      // The normaliser, the other way: unwrapping the live text gives back PRE exactly.
      expect(Object.fromEntries(PRE.map(([, p]) => [p, [unwrapCalls(live.get(p)!.q), unwrapCalls(live.get(p)!.w)]])))
        .toEqual(Object.fromEntries(PRE.map(([, p, , q, w]) => [p, [q, w]])));
    }));

  it("the 72 policies 0109 does not list are byte-identical to before (green before and after; mutation: alter one of them in 0109 -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ d: string }>(
        `select count(*) || '|' || md5(string_agg(tablename || '|' || policyname || '|' || permissive || '|' ||
            array_to_string(roles, ',') || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
            E'\\n' order by tablename, policyname)) as d
           from pg_policies where schemaname = 'public' and policyname <> all ($1::text[])`, [PRE.map((r) => r[1])]);
      expect(rows[0]!.d).toBe("72|c2a5a17e0ef4f6e27247f8df517ddb4f");
    }));

  it("public still holds 136 policies on 64 tables: none added, none dropped (green before and after)", () =>
    withRollback(async (c) => {
      const rows = await livePolicies(c);
      expect([rows.length, new Set(rows.map((r) => r.t)).size]).toEqual([136, 64]);
    }));
});

describe("0109: the guard that keeps the fast shape", () => {
  it("no policy in public calls a helper once per row, except inbound_never_log_no_technician's row-argument call (red before 0109: names the 64; mutation: leave one policy unwrapped -> FAILS naming it; rewrite the allowed one -> FAILS naming it)", () =>
    withRollback(async (c) => {
      // Deparse under pg_catalog alone, so every app.* and auth.* call is printed schema-qualified whatever the
      // connection's search_path is: with app on the path, app.is_agency() would print as is_agency() and pass.
      await c.query("set local search_path = pg_catalog");
      const rows = await livePolicies(c);
      expect(offenders(rows)).toEqual([]);
      // The allow-list is not stale: the allowed call is still there, verbatim.
      const allowed = rows.find((r) => r.p === "inbound_never_log_no_technician");
      expect(perRowCalls(allowed?.q ?? null), "inbound_never_log_no_technician changed: re-review ALLOWED_PER_ROW")
        .toEqual(["app.sees_all_customers(account_id)"]);
    }));

  it("the detector names a bare call, a call in a correlated sub-select, a row-argument call, a helper with a digit in its name and a bare read of the claims, and passes the wrapped shapes and other settings (green before and after: it tests the detector, not 0109)", () =>
    withRollback(async (c) => {
      await c.query(`create policy zz_probe_bare on public.tags for select to authenticated using (account_id = app.current_account_id())`);
      await c.query(`create policy zz_probe_correlated on public.tags for select to authenticated
        using ((select app.sees_all_customers(account_id)))`);
      await c.query(`create policy zz_probe_exists on public.tags for select to authenticated
        using (exists (select 1 from public.contacts x where x.account_id = tags.account_id and x.account_id = app.current_account_id()))`);
      await c.query(`create policy zz_probe_wrapped on public.tags for select to authenticated
        using ((select app.is_agency()) or account_id = (select app.current_account_id()))`);
      await c.query(`create function app.zz_probe_2() returns boolean language sql stable as 'select true'`);
      await c.query(`create policy zz_probe_digit on public.tags for select to authenticated using (app.zz_probe_2())`);
      await c.query(`create policy zz_probe_claims on public.tags for select to authenticated
        using ((current_setting('request.jwt.claims', true)::jsonb ->> 'org_id') is not null)`);
      await c.query(`create policy zz_probe_claims_wrapped on public.tags for select to authenticated
        using ((select current_setting('request.jwt.claims', true)) is not null)`);
      await c.query(`create policy zz_probe_other_setting on public.tags for select to authenticated
        using (current_setting('timezone') is not null)`);
      const probes = async () => offenders((await livePolicies(c)).filter((r) => r.p.startsWith("zz_probe_")));
      // The blind spot the guard's own search_path closes: with app on the path the call prints unqualified.
      await c.query("set local search_path = app, public, pg_catalog");
      expect(await probes()).not.toContain("zz_probe_bare: app.current_account_id()");
      await c.query("set local search_path = pg_catalog");
      expect(await probes()).toEqual([
        "zz_probe_bare: app.current_account_id()",
        "zz_probe_claims: current_setting('request.jwt.claims'::text, true)",
        "zz_probe_correlated: app.sees_all_customers(tags.account_id)",
        "zz_probe_digit: app.zz_probe_2()",
        "zz_probe_exists: app.current_account_id()",
      ]);
    }));
});
