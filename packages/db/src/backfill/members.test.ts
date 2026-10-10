import { describe, it, expect } from "vitest";
import { planMemberBackfill, memberBackfillSql, type BackfillAccount, type ClerkOrgMember } from "./members";
import { withRollback } from "../test/db";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";

const member = (o: Partial<ClerkOrgMember> = {}): ClerkOrgMember => ({
  clerkUserId: "user_1", email: "a@example.com", name: "A One", clerkRole: "org:member",
  membershipMeta: null, userMeta: null, ...o,
});

describe("planMemberBackfill — the same rule the webhook and the fallback use (team.ts)", () => {
  it("org:admin with no metadata maps to owner, org:member maps to staff, and the membership's bis_role wins (mutation: default to owner -> the staff case fails)", () => {
    const accounts: BackfillAccount[] = [{ id: ACCOUNT_A, clerk_org_id: "org_a" }];
    const { rows } = planMemberBackfill(accounts, {
      org_a: [
        member({ clerkUserId: "u_admin", clerkRole: "org:admin" }),
        member({ clerkUserId: "u_member", clerkRole: "org:member" }),
        member({ clerkUserId: "u_bis_role", clerkRole: "org:admin", membershipMeta: { bis_role: "staff" } }),
      ],
    });
    expect(rows.find((r) => r.clerkUserId === "u_admin")!.role).toBe("owner");
    expect(rows.find((r) => r.clerkUserId === "u_member")!.role).toBe("staff");
    expect(rows.find((r) => r.clerkUserId === "u_bis_role")!.role).toBe("staff");
  });

  it("an agency user (userMeta.app_role === agency_admin) is skipped and counted, never written (mutation: drop the skip -> FAILS)", () => {
    const accounts: BackfillAccount[] = [{ id: ACCOUNT_A, clerk_org_id: "org_a" }];
    const { rows, skippedAgency } = planMemberBackfill(accounts, {
      org_a: [member({ clerkUserId: "u_agency", userMeta: { app_role: "agency_admin" } })],
    });
    expect(rows).toHaveLength(0);
    expect(skippedAgency).toBe(1);
  });

  it("a member with no email is skipped and counted, never written (mutation: drop the skip -> FAILS)", () => {
    const accounts: BackfillAccount[] = [{ id: ACCOUNT_A, clerk_org_id: "org_a" }];
    const { rows, skippedNoEmail } = planMemberBackfill(accounts, {
      org_a: [member({ clerkUserId: "u_noemail", email: null })],
    });
    expect(rows).toHaveLength(0);
    expect(skippedNoEmail).toBe(1);
  });

  it("an account with no entry in membersByOrg plans zero rows, not a throw (mutation: drop the ?? [] fallback -> throws reading undefined)", () => {
    const accounts: BackfillAccount[] = [{ id: ACCOUNT_A, clerk_org_id: "org_missing" }];
    expect(planMemberBackfill(accounts, {}).rows).toHaveLength(0);
  });
});

describe("memberBackfillSql — the statement the orchestrator pastes", () => {
  it("quotes O'Brien safely: the emitted text contains 'O''Brien' (mutation: drop the quote doubling -> FAILS)", () => {
    const { rows } = planMemberBackfill(
      [{ id: ACCOUNT_A, clerk_org_id: "org_a" }],
      { org_a: [member({ clerkUserId: "u_ob", name: "O'Brien" })] },
    );
    const sql = memberBackfillSql(rows);
    expect(sql).toContain("'O''Brien'");
  });

  it("is idempotent in shape: upserts users on conflict (clerk_user_id) touching only email, and inserts memberships on conflict (account_id, user_id) do nothing (mutation: do update set role -> FAILS)", () => {
    const { rows } = planMemberBackfill([{ id: ACCOUNT_A, clerk_org_id: "org_a" }], { org_a: [member()] });
    const sql = memberBackfillSql(rows);
    expect(sql).toContain("on conflict (clerk_user_id) do update set email = excluded.email");
    expect(sql).toContain("on conflict (account_id, user_id) do nothing");
    expect(sql).not.toMatch(/do update set role/);
  });

  it("refuses an empty rows list rather than emit an invalid statement (mutation: drop the check -> FAILS)", () => {
    expect(() => memberBackfillSql([])).toThrow(/nothing to write/);
  });

  it("never emits a backslash — the MCP mangles it (mutation: drop the backslash guard -> a name carrying one would be emitted unchecked, FAILS)", () => {
    const { rows } = planMemberBackfill(
      [{ id: ACCOUNT_A, clerk_org_id: "org_a" }],
      { org_a: [member({ clerkUserId: "u_bs", name: "back\\slash" })] },
    );
    expect(() => memberBackfillSql(rows)).toThrow(/backslash/);
  });
});

describe("memberBackfillSql on the local database — idempotent and never a downgrade (brief step 1, item 5)", () => {
  it("running the emitted SQL twice leaves one owner membership, and a manual demotion survives a third run (mutation: do update set role instead of do nothing -> the demotion is undone, FAILS)", () =>
    withRollback(async (c) => {
      const RUN = Math.random().toString(36).slice(2, 10);
      const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
      const acct = (await c.query<{ id: string }>(
        "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'MB Co') returning id",
        [agency!.id, `org_mb_${RUN}`],
      )).rows[0]!.id;
      const { rows } = planMemberBackfill(
        [{ id: acct, clerk_org_id: `org_mb_${RUN}` }],
        { [`org_mb_${RUN}`]: [member({ clerkUserId: `user_mb_${RUN}`, email: `mb_${RUN}@example.com`, clerkRole: "org:admin" })] },
      );
      const sql = memberBackfillSql(rows);

      await c.query(sql);
      await c.query(sql); // idempotent: run twice

      const role = (text: string) => c.query<{ role: string }>(text, [acct, `user_mb_${RUN}`]);
      const SELECT_ROLE =
        "select m.role from memberships m join users u on u.id = m.user_id where m.account_id = $1 and u.clerk_user_id = $2";
      expect((await role(SELECT_ROLE)).rows).toEqual([{ role: "owner" }]);

      await c.query("update memberships set role = 'staff' where account_id = $1", [acct]);
      await c.query(sql); // a third run, after a manual demotion
      expect((await role(SELECT_ROLE)).rows).toEqual([{ role: "staff" }]);
    }));

  it("an apostrophe name and a non-ASCII name round-trip through the database unchanged (mutation: drop the quote doubling -> the O'Brien row's insert fails/mismatches, FAILS)", () =>
    withRollback(async (c) => {
      const RUN = Math.random().toString(36).slice(2, 10);
      const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
      const acct = (await c.query<{ id: string }>(
        "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'MB Names') returning id",
        [agency!.id, `org_mbn_${RUN}`],
      )).rows[0]!.id;
      const { rows } = planMemberBackfill(
        [{ id: acct, clerk_org_id: `org_mbn_${RUN}` }],
        {
          [`org_mbn_${RUN}`]: [
            member({ clerkUserId: `user_ob_${RUN}`, email: `ob_${RUN}@example.com`, name: "O'Brien" }),
            member({ clerkUserId: `user_mz_${RUN}`, email: `mz_${RUN}@example.com`, name: "Muñoz" }),
          ],
        },
      );
      await c.query(memberBackfillSql(rows));
      const { rows: names } = await c.query<{ clerk_user_id: string; name: string }>(
        "select clerk_user_id, name from users where clerk_user_id = any($1) order by clerk_user_id",
        [[`user_ob_${RUN}`, `user_mz_${RUN}`]],
      );
      expect(names).toEqual([
        { clerk_user_id: `user_mz_${RUN}`, name: "Muñoz" },
        { clerk_user_id: `user_ob_${RUN}`, name: "O'Brien" },
      ]);
    }));

  it("re-running after the webhook has already set a role never touches it, even to the SAME role that would have been backfilled (mutation: do update set role = excluded.role -> harmless here too, since values agree; use an opposing backfill role to catch it, FAILS if conflict touches role)", () =>
    withRollback(async (c) => {
      const RUN = Math.random().toString(36).slice(2, 10);
      const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
      const acct = (await c.query<{ id: string }>(
        "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'MB Live') returning id",
        [agency!.id, `org_mbl_${RUN}`],
      )).rows[0]!.id;
      const u = (await c.query<{ id: string }>(
        "insert into users (clerk_user_id, email) values ($1,$2) returning id",
        [`user_mbl_${RUN}`, `mbl_${RUN}@example.com`],
      )).rows[0]!.id;
      // The webhook already made this person Staff (live state) before the backfill ever ran.
      await c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$2,'staff')", [u, acct]);
      // The backfill's own read of Clerk says org:admin -> owner.
      const { rows } = planMemberBackfill(
        [{ id: acct, clerk_org_id: `org_mbl_${RUN}` }],
        { [`org_mbl_${RUN}`]: [member({ clerkUserId: `user_mbl_${RUN}`, email: `mbl_${RUN}@example.com`, clerkRole: "org:admin" })] },
      );
      await c.query(memberBackfillSql(rows));
      const { rows: roleRows } = await c.query<{ role: string }>("select role from memberships where user_id = $1", [u]);
      expect(roleRows).toEqual([{ role: "staff" }]);
    }));
});
