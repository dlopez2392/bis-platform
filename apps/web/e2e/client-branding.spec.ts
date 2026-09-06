import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setBranding, getBranding, setClientAccess } from "@bis/db";
import { mintClientToken } from "./support";

// Same two paths, same reason, as auth.setup.ts: this file calls serviceDb()
// and the Clerk API from the Playwright runner process, not through a Next
// request, so nothing auto-loads the env for it.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

type ClientFixture = { accountId: string; clerkUserId: string };
const fixture = (): ClientFixture =>
  JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as ClientFixture;

/** The agency's own seeded account — the "someone else" in the negative case. */
const OTHER_ACCOUNT = "45240784-a70e-43a0-8a0c-0027c7073f98";

/**
 * PostgREST, called directly with the client's own token.
 *
 * Returns the raw response `body` as well as the status: a bare
 * `status >= 400` assertion passes for ANY refusal, including a typo'd column
 * name, so a test that only reads the status can prove a boundary that isn't
 * there. Case 5 below asserts the REASON.
 */
async function patchAccount(
  token: string, accountId: string, body: Record<string, unknown>,
): Promise<{ status: number; rows: unknown[]; body: string }> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/accounts?id=eq.${accountId}&select=id`,
    {
      method: "PATCH",
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
    },
  );
  const text = await res.text();
  const rows = res.ok ? (JSON.parse(text) as unknown[]) : [];
  return { status: res.status, rows, body: text };
}

/**
 * This spec's own precondition, established rather than assumed — the same
 * beforeAll tenant-theme.spec.ts needs, for the same reason.
 *
 * client-access.spec.ts ends by switching this fixture's client access OFF and
 * deliberately does not restore it (auth.teardown deletes the whole fixture
 * afterwards, so from that spec's point of view there is nothing to tidy).
 * "client-branding" sorts after "client-access", so on a full run this file
 * inherited a disabled account — and `accounts_member_update` requires
 * `client_access_enabled`, so every write below was correctly refused and the
 * suite read as a broken feature rather than a disabled session.
 *
 * Worth stating plainly: that failure was the policy working. A spec that
 * passes or fails on filename order is a spec that proves nothing either way.
 */
test.beforeAll(async () => {
  const { accountId, clerkUserId } = fixture();
  await setClientAccess(serviceDb(), accountId, true, clerkUserId);
});

/**
 * The M2 lesson governs this file. Every assertion in that milestone's client
 * spec was absence-based, and all five passed while the client's entire CRM
 * was a 404 — absence proves nothing on its own. So the positive case comes
 * FIRST here: without it, every negative below would pass just as happily
 * against a client that can write nothing at all.
 */
test.describe("a client's branding boundary, at the database", () => {
  test("writes its own branding columns, and nothing else, on its own row only", async () => {
    const { accountId, clerkUserId } = fixture();
    const token = await mintClientToken(clerkUserId);
    const before = await getBranding(serviceDb(), accountId);
    const otherBefore = await getBranding(serviceDb(), OTHER_ACCOUNT);

    try {
      // 1. THE POSITIVE CASE.
      const own = await patchAccount(token, accountId, { brand_color: "#123456" });
      expect(own.rows, "a client must be able to write its own branding").toHaveLength(1);
      expect((await getBranding(serviceDb(), accountId)).brandColor).toBe("#123456");

      // 2. Another company's branding. RLS FILTERS rather than throwing, so
      //    the tell is zero rows on a 2xx — not an error status.
      const other = await patchAccount(token, OTHER_ACCOUNT, { brand_color: "#654321" });
      expect(other.rows, "another company's row must be invisible to this update").toHaveLength(0);
      expect((await getBranding(serviceDb(), OTHER_ACCOUNT)).brandColor).toBe(otherBefore.brandColor);

      // 3. The escalation the column grant exists to stop. Without it a client
      //    could switch their own access back on after the agency turned it
      //    off — the policy alone is row-scoped and would permit this.
      const escalate = await patchAccount(token, accountId, { client_access_enabled: true });
      expect(escalate.status, "client_access_enabled must be refused by privilege")
        .toBeGreaterThanOrEqual(400);

      // 4. `name` is the agency's private label for this company, not theirs.
      const rename = await patchAccount(token, accountId, { name: "renamed by client" });
      expect(rename.status, "the agency's internal label must be refused")
        .toBeGreaterThanOrEqual(400);

      // 5. THE ASSERTION THE A2P PHASE EXISTS FOR. Migration 0023 adds the
      //    `a2p_*` columns and deliberately does not grant them, so a client
      //    cannot record their own carrier approval — which, since the
      //    activation checklist now DERIVES from a2p_status, would otherwise
      //    let them tick themselves cleared to text. Unit tests mock the
      //    database and are blind to column grants (three shipped defects in
      //    this repo already), so this is the only test that can see it.
      const a2p = await patchAccount(token, accountId, { a2p_status: "approved" });
      expect(a2p.status, "a client must not be able to write A2P state")
        .toBeGreaterThanOrEqual(400);
      //    And refused BY PRIVILEGE, not by a typo. Without this the assertion
      //    above would pass just as happily against a misspelled column, which
      //    is precisely the false green this phase is trying not to ship.
      //    `42501` is Postgres's insufficient_privilege; an unknown column
      //    comes back as PGRST204 instead, so this discriminates. Postgres
      //    reports it for the TABLE rather than naming a2p_status — 0013's
      //    revoke is table-wide, and the column-level re-grant simply never
      //    covered this column.
      expect(a2p.body, "the refusal must be insufficient_privilege, not a bad column")
        .toContain("42501");
    } finally {
      // Unconditional, and it covers the case this test exists to disprove:
      // if assertion 2 ever fails, the agency's real account has been written
      // to, and leaving it that way would be worse than the failing test.
      await setBranding(serviceDb(), accountId, { brandColor: before.brandColor }, clerkUserId);
      await setBranding(serviceDb(), OTHER_ACCOUNT,
        { brandColor: otherBefore.brandColor }, clerkUserId);
    }
  });
});

test.describe("a client edits their branding in the browser", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("changes the colour from their own Branding page and it persists", async ({ page }) => {
    const { accountId, clerkUserId } = fixture();
    const before = await getBranding(serviceDb(), accountId);

    try {
      await page.goto(`/dashboard/accounts/${accountId}/branding`);

      // The nav item exists for a client — the surface, not just the route.
      await expect(page.getByRole("link", { name: "Branding" })).toBeVisible();

      // A client must never see or set the sending address. The structural
      // guarantee is that the column carries no grant (spec §5); this is the
      // surface-level half of the same boundary.
      await expect(page.getByLabel("Sending address")).toHaveCount(0);

      // `#brand-color`, NOT getByLabel("Brand color"): the text field and the
      // colour picker beside it share that accessible name, so a label query
      // is ambiguous under strict mode. The text field is the one that submits
      // (see the comment in branding-panel.tsx).
      await page.locator("#brand-color").fill("#0f766e");
      // The reply-to rides the same write, and it is the only assertion in the
      // suite that exercises its COLUMN GRANT: a client's save runs as the
      // RLS-enforced client, so a column missing from migration 0014's grant is
      // filtered out here and nowhere else. The agency, writing through the
      // service role, would never see it.
      await page.locator("#reply-to-email").fill("hello@rioroofing.com");
      await page.getByRole("button", { name: "Save" }).click();

      await expect(page.getByText("Branding updated")).toBeVisible();

      // The database, not the toast. A toast proves a response, not a write.
      await expect
        .poll(async () => (await getBranding(serviceDb(), accountId)).brandColor)
        .toBe("#0f766e");
      await expect
        .poll(async () => (await getBranding(serviceDb(), accountId)).replyToEmail)
        .toBe("hello@rioroofing.com");
    } finally {
      await setBranding(serviceDb(), accountId,
        { brandColor: before.brandColor, replyToEmail: before.replyToEmail }, clerkUserId);
    }
  });
});

/**
 * The tab. M3 gave a client's workspace its own TITLE and deliberately left
 * the icon, so their staff read their own company name all day beside the
 * agency's mark — and their customers loaded a lead form wearing it too.
 *
 * Asserted as the resolved `href` of the icon link, not as the presence of a
 * metadata key: the point is what the browser is told to fetch. The fixture's
 * logo path is a content-addressed object under its own account id, so the
 * href containing that account id is the proof it is THIS client's logo and
 * not some other account's.
 */
test.describe("the browser tab carries the client's own mark", () => {
  test("on their workspace and on the form their customers load", async ({ browser, baseURL }) => {
    const { accountId } = fixture();

    const signedIn = await browser.newContext({
      storageState: "e2e/.auth/client-state.json", baseURL,
    });
    try {
      const page = await signedIn.newPage();
      await page.goto(`/dashboard/accounts/${accountId}/contacts`);
      const icon = await page.locator('link[rel~="icon"]').first()
        .getAttribute("href");
      expect(icon, "a branded client's workspace tab").toContain(accountId);
      expect(icon).toContain("brand-logos");
    } finally {
      await signedIn.close();
    }

    // The agency's own tab is unchanged. This is the regression guard for the
    // icon moving from `app/favicon.ico` (a file convention) to public/ plus a
    // metadata key — the move is what makes a per-client override possible,
    // and the way it could go wrong silently is the agency ending up with a
    // 404 for an icon nobody looks at closely.
    const agency = await browser.newContext({
      storageState: "e2e/.auth/state.json", baseURL,
    });
    try {
      const page = await agency.newPage();
      await page.goto("/dashboard/accounts");
      const icon = await page.locator('link[rel~="icon"]').first().getAttribute("href");
      expect(icon, "the agency keeps the BIS mark").toBe("/favicon.ico");
      expect((await page.request.get("/favicon.ico")).status(),
        "and it is actually served").toBe(200);
    } finally {
      await agency.close();
    }

    // Anonymous, like a real visitor: the public form is the surface this
    // milestone exists for.
    const anon = await browser.newContext({ baseURL });
    try {
      const page = await anon.newPage();
      const { formPublicId } = JSON.parse(
        readFileSync("e2e/.auth/client-fixture.json", "utf-8"),
      ) as { formPublicId: string };
      await page.goto(`/f/${formPublicId}`);
      const icon = await page.locator('link[rel~="icon"]').first().getAttribute("href");
      expect(icon, "the client's own customers see the client's mark").toContain(accountId);
    } finally {
      await anon.close();
    }
  });
});
