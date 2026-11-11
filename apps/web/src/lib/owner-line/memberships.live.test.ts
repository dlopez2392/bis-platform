import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config as loadEnv } from "dotenv";
import { refuseProduction } from "../../../e2e/fixtures/production-guard";

// The weekly-metrics.live.test.ts discipline: apps/web's test script runs with this directory as cwd, and its
// credentials live in `.env.local`. CI verify runs it against the runner's own stack; never run it against bis-ci
// before 0115 is there.
loadEnv({ path: ".env.local" });
refuseProduction(process.env, "lib/owner-line/memberships.live.test.ts");

import { serviceDb, createAccount, deleteAccountCascade } from "@bis/db";
import { listMyMemberships, myMembership } from "./memberships";

/**
 * F-032 Task 5 review I-1: the tenancy line of the "Call in to your business" card is `users!inner(clerk_user_id)`
 * in listMyMemberships. Without `!inner`, PostgREST's filter on the embedded users row only BLANKS that embed, so every
 * membership in the database comes back, and myMembership(serviceDb(), <Ben>, A) answered A's Owner's row to Ben, who
 * is Staff on B only (proved on a replica by the reviewer). A mocked builder cannot show what PostgREST does with an
 * embed filter, so this is the live proof: two people, two businesses, real rows.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ANA = `user_ol_memb_ana_${RUN}`;
const BEN = `user_ol_memb_ben_${RUN}`;
const svc = () => serviceDb();
const accounts: string[] = [];
const subs: string[] = [];
let A = "";
let B = "";
let anaId = "";
let benId = "";

async function must<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T> {
  const r = await q;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}
async function business(label: string): Promise<string> {
  const { id } = await createAccount(svc(), {
    clerkOrgId: `org_test_ol_memb_${label}_${RUN}`, name: `Fixture Co (owner line memberships ${label})`, actorId: "user_test" });
  accounts.push(id);
  await must(svc().from("accounts").update({ client_access_enabled: true, brand_name: `Brand ${label}` }).eq("id", id).select("id"), "account");
  return id;
}
async function person(sub: string, accountId: string, role: "owner" | "staff"): Promise<string> {
  const u = await must<{ id: string }>(svc().from("users").insert({ clerk_user_id: sub, email: `${sub}@example.invalid`, name: sub }).select("id").single(), "user");
  subs.push(sub);
  await must(svc().from("memberships").insert({ user_id: u.id, scope: "account", account_id: accountId, role }).select("id").single(), "membership");
  return u.id;
}

describe("listMyMemberships / myMembership against the database (review I-1)", () => {
  beforeAll(async () => {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY missing — this suite needs apps/web/.env.local (CI verify provides it)");
    }
    A = await business("a");
    B = await business("b");
    anaId = await person(ANA, A, "owner");
    benId = await person(BEN, B, "staff");
  });
  afterAll(async () => {
    for (const id of accounts) await deleteAccountCascade(svc(), id, "lib/owner-line/memberships.live.test.ts");
    for (const sub of subs) {
      const { error } = await svc().from("users").delete().eq("clerk_user_id", sub);
      if (error) throw new Error(`users cleanup failed: ${error.message}`);
    }
  });

  it("the person on B asking for A gets null; the person on A asking for A gets their own row (mutation: drop !inner from users -> FAILS)", async () => {
    expect(await myMembership(svc(), BEN, A)).toBeNull();
    expect(await myMembership(svc(), ANA, A)).toEqual(
      { accountId: A, userId: anaId, role: "owner", businessName: "Brand a", number: null });
  });

  it("each person's list holds their own business only, never the other's (second account)", async () => {
    expect(await listMyMemberships(svc(), BEN)).toEqual(
      [{ accountId: B, userId: benId, role: "staff", businessName: "Brand b", number: null }]);
    expect((await listMyMemberships(svc(), ANA)).map((x) => x.accountId)).toEqual([A]);
    expect(await myMembership(svc(), ANA, B)).toBeNull();
  });
});
