import { test, expect, type Page } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact, ensureReplyToken } from "@bis/db";
import { m } from "../src/lib/messages";
import { readClientFixture } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * Inbound email, part 1 (spec "Tests": "a held email is filed from Needs a look, then undone"; plan Task 14).
 * The webhook itself is proven by route tests (inbound mail reaches production only, spec "Owner actions");
 * here a HELD row is seeded with the service client and a person files it from the inbox, sees it on the
 * thread, undoes, and sees it back in Needs a look. ON THE PER-RUN FIXTURE ACCOUNT ONLY, on one stamped
 * contact made here; never Test Client One. afterAll deletes the inbound row, the thread's messages, the
 * conversation and the contact, checking every error, then re-reads that none is left.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

const STAMP = `Inbound${Date.now()}`;
const ACTOR = "e2e-inbound-email";
let accountId = "";
let contactId = "";
let conversationId = "";
let inboundId = "";
const db = () => serviceDb();
const inbox = (q = "") => `/dashboard/accounts/${accountId}/conversations${q}`;
const item = (page: Page) => page.locator(`[data-held-item="${inboundId}"]`);

test.beforeAll(async () => {
  const fixture = readClientFixture();
  if (!fixture) throw new Error("inbound-email.spec: no per-run fixture account (e2e/.auth/client-fixture.json). Run the full suite.");
  accountId = fixture.accountId;
  const c = await createContact(db(), accountId, { firstName: "Respuesta", lastName: STAMP, email: `${STAMP.toLowerCase()}@example.com` }, ACTOR);
  if (c.existing) throw new Error("inbound-email.spec: the stamped contact matched an existing one; refusing to use (or delete) it.");
  contactId = c.id;
  ({ conversationId } = await ensureReplyToken(db(), accountId, contactId, ACTOR));
  const { data, error } = await db().from("inbound_emails").insert({
    account_id: accountId, conversation_id: conversationId, provider_email_id: `e2e_${STAMP}`,
    from_email: "neighbour@example.com", from_name: "Vecino", to_email: "r-x@reply.bis-rgv.com",
    subject: `Re: ${STAMP}`, text: `Is Thursday ok? ${STAMP}`, attachment_count: 2, status: "held", hold_reason: "not_on_record",
    received_at: new Date().toISOString(),
  }).select("id").single();
  if (error || !data) throw new Error(`inbound-email.spec: seed failed: ${error?.message}`);
  inboundId = data.id;
});

test.afterAll(async () => {
  if (!accountId) return;
  const svc = db();
  if (inboundId) { const { error } = await svc.from("inbound_emails").delete().eq("id", inboundId); expect(error).toBeNull(); }
  if (conversationId) {
    const { error: e1 } = await svc.from("messages").delete().eq("account_id", accountId).eq("conversation_id", conversationId); expect(e1).toBeNull();
    const { error: e2 } = await svc.from("conversations").delete().eq("account_id", accountId).eq("id", conversationId); expect(e2).toBeNull();
  }
  if (contactId) { const { error } = await svc.from("contacts").delete().eq("account_id", accountId).eq("id", contactId); expect(error).toBeNull(); }

  const { count, error } = await svc.from("inbound_emails").select("id", { count: "exact", head: true }).eq("provider_email_id", `e2e_${STAMP}`);
  expect(error).toBeNull(); expect(count).toBe(0);

  // Fix round 1 (review): the document-requirements.spec.ts shape — re-read every row this
  // afterAll just deleted, by the SAME id it deleted it by, and assert none is left, rather than
  // trusting the delete calls' own null-error check alone.
  if (contactId) {
    const { data: leftContact, error: cErr } = await svc.from("contacts").select("id").eq("account_id", accountId).eq("id", contactId);
    expect(cErr).toBeNull(); expect(leftContact ?? []).toEqual([]);
  }
  if (conversationId) {
    const { data: leftConvo, error: convErr } = await svc.from("conversations").select("id").eq("account_id", accountId).eq("id", conversationId);
    expect(convErr).toBeNull(); expect(leftConvo ?? []).toEqual([]);
    const { data: leftMsgs, error: msgErr } = await svc.from("messages").select("id").eq("account_id", accountId).eq("conversation_id", conversationId);
    expect(msgErr).toBeNull(); expect(leftMsgs ?? []).toEqual([]);
  }
});

test("a held email waits in Needs a look, with its reason and the suggestion", async ({ page }) => {
  await page.goto(inbox());
  await page.locator("[data-held-filter]").click();
  await expect(page).toHaveURL(/view=held/);
  await expect(item(page)).toContainText(m["conversations.held.reason.notOnRecord"]);
  await expect(item(page)).toContainText(`Re: ${STAMP}`);
  await expect(item(page)).toContainText(m["conversations.held.suggestion"].replace("{name}", `Respuesta ${STAMP}`));
});

test("File on the customer puts it on their thread; Undo brings it back to Needs a look, and the now-empty thread leaves the inbox list", async ({ page }) => {
  await page.goto(inbox("?view=held"));
  await item(page).getByRole("button", { name: m["conversations.held.fileOn"].replace("{name}", `Respuesta ${STAMP}`) }).click();
  await expect(item(page)).toHaveCount(0);
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: m["conversations.held.filed"].replace("{name}", `Respuesta ${STAMP}`) });
  await expect(toast).toBeVisible();
  const { data: filed } = await db().from("inbound_emails").select("status, message_id").eq("id", inboundId).single();
  expect(filed?.status).toBe("filed");
  await toast.getByRole("button", { name: m["common.undo"] }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["conversations.held.undone"] })).toBeVisible();
  const { data: back } = await db().from("inbound_emails").select("status, message_id").eq("id", inboundId).single();
  expect(back).toEqual({ status: "held", message_id: null });
  const { count } = await db().from("messages").select("id", { count: "exact", head: true }).eq("id", filed!.message_id!);
  expect(count).toBe(0);
  await page.goto(inbox("?view=held"));
  await expect(item(page)).toHaveCount(1);

  // Owner ruling 2026-10-16 (reviewer request): the inbox lists only conversations with >=1
  // message (listConversations's `messages!inner(id)` existence filter). Undo deleted the
  // thread's only message, so the thread itself must leave the REGULAR inbox list too, not
  // just stay off it while held — a thread sitting in Needs a look is never also a row there,
  // but this proves the general rule rather than relying on that overlap.
  await page.goto(inbox());
  await expect(page.locator(`a[href*="?c=${conversationId}"]`)).toHaveCount(0);
});

test("filed for real, it reads on the thread as the customer's email, with its attachments line", async ({ page }) => {
  await page.goto(inbox("?view=held"));
  await item(page).getByRole("button", { name: m["conversations.held.fileOn"].replace("{name}", `Respuesta ${STAMP}`) }).click();
  await expect(item(page)).toHaveCount(0);
  // Wait for the File to LAND before leaving the page. The row leaves the list optimistically, at the
  // click and before fileHeldEmailAction is even sent (held-email-list.tsx's runFile calls onHide()
  // first), so `toHaveCount(0)` alone passes at once and the goto below raced the action: either it
  // cancelled the action's request, or the thread rendered before the message existed and nothing
  // re-read it. That race was this test's intermittent "element(s) not found" on the bubble: CI runs
  // 39050045568 and 39094288407 on main, 39267488188 and 39277988173 on feat/item8b-review-tray, and most
  // likely 38982614726 too, the getByRole("paragraph") failure the comment below puts down to Chromium's
  // role mapping (same symptom, same step, before the locator changed). The success
  // toast fires only after the action resolves ok (held-email-handlers.ts's runHeldAction), and the
  // stored status is then read back, the same two steps the File-then-Undo test above takes.
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["conversations.held.filed"].replace("{name}", `Respuesta ${STAMP}`) })).toBeVisible();
  const { data: filed, error: filedErr } = await db().from("inbound_emails").select("status, message_id").eq("id", inboundId).single();
  expect(filedErr).toBeNull();
  expect(filed?.status).toBe("filed");
  expect(filed?.message_id, "File must have written the thread's message").toBeTruthy();
  await page.goto(inbox(`?c=${conversationId}`));
  // CI fix (strict-mode violation): the inbox's own list panel truncates the
  // SAME body text into its row preview (<span class="truncate ...">), so a
  // bare page.getByText here matches that preview AND the thread bubble.
  // message-thread.tsx has no stable data-attribute to scope by (an app-source
  // change, out of scope for this test-only fix), but its bubble is a real <p>
  // and the list's preview is a <span> — getByRole("paragraph") excludes it.
  // A CSS `p` locator, not getByRole("paragraph"): CI's Chromium did not expose the bubble under
  // that role (element(s) not found), while the first failure showed it IS a plain <p>.
  await expect(page.locator("p").filter({ hasText: `Is Thursday ok? ${STAMP}` })).toBeVisible();
  // The stored attachment count survives a manual File (owner ruling 2026-10-16).
  // Not duplicated in the list preview (which carries only the body text), so
  // this one stays a plain getByText.
  await expect(page.getByText(m["conversations.reply.attachments"].replace("{count}", "2"))).toBeVisible();
});
