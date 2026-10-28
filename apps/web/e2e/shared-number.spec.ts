import { test, expect } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact, ensureHoldingContact, ensureConversation, createMessage, deleteContacts } from "@bis/db";
import { m } from "../src/lib/messages";

// Same two paths, same reason, as every other spec that talks to Supabase from the Playwright runner
// process directly (seeding, cleanup), not through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-47e, plan Task 16 (plan P12): the inbox's "Move to…" and its Undo on a shared number's holding
 * thread (0098) — the one e2e spec, because the binding process rule asks for one and the Move is not
 * a phone path any other suite exercises.
 *
 * FIXTURE DISCIPLINE. Both tests run on the per-run client fixture (auth.setup.ts / auth.teardown.ts),
 * signed in as its own Owner (client-state.json) — never on `Test Client One` or any other live
 * account: `beforeAll` writes two real contacts and a holding record on a number unique to this run.
 * `readFixture()` skips the whole file with a reason when the fixture is missing, the same local
 * shape `one-switch.spec.ts` (:66-75) and `ai-disclosure.spec.ts` use.
 *
 * SEED, from the real writers only (never a hand-shaped row): `createContact` with
 * `matchBy: "email_only"` for Ana and Beto, on the SAME phone, so the second one never lands on the
 * first through the ordinary phone match (contacts.test.ts's own "the holding skip" suite, same
 * idiom) — two distinct people really do share this number. `ensureHoldingContact` (writer "sms",
 * since this holding record stands for a shared number's INCOMING TEXTS, not a call) makes the one
 * holding record 0098 keys by the exact E.164; its thread is `ensureConversation`, and one inbound
 * text is `createMessage` with the SAME actor shape `sms/inbound`'s own route uses
 * (`ACTOR_TYPE: "system"` — apps/web/src/app/api/sms/inbound/route.ts:55-56,221-228) so this seed is
 * provenance-true, not merely plausible.
 *
 * LOCATORS (R12): never a bare `getByText("Beto Prueba")` or `getByText("Shared number …")` — after
 * the Move those words are in the toast, the thread header and the inbox row at once, and Playwright's
 * strict mode fails on two matches. Every one of those is scoped by attribute (`[data-thread-name]`,
 * `[data-conversation-row=…]`, `[data-holding-move]`, `[data-sonner-toast]`) or by role, and every
 * catalogue sentence is `m[…]` with its placeholder filled, never retyped.
 */
test.describe.configure({ mode: "serial", timeout: 60_000 });
test.use({ storageState: "e2e/.auth/client-state.json" });

type ClientFixture = { accountId: string; clerkUserId: string };
const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";

function readFixture(): ClientFixture | null {
  if (!existsSync(CLIENT_FIXTURE_FILE)) return null;
  const parsed = JSON.parse(readFileSync(CLIENT_FIXTURE_FILE, "utf-8")) as Partial<ClientFixture>;
  if (!parsed.accountId || !parsed.clerkUserId) return null;
  return parsed as ClientFixture;
}

const ACTOR = "e2e-shared-number-spec";

let fixtureRef: ClientFixture | null = null;
let accountId = "";
let skipReason: string | null = null;

let tag = "";
let number = "";
let formattedNumber = "";
let threadLabel = "";
let anaId = "";
let betoId = "";
let holdingId = "";
let holdingConversationId = "";
let messageId = "";

test.beforeAll(async () => {
  const fixture = readFixture();
  if (!fixture) {
    skipReason = "No client fixture — the setup project creates it; run the full suite.";
    test.skip(true, skipReason);
    return;
  }
  fixtureRef = fixture;
  accountId = fixture.accountId;
  const svc = serviceDb();

  // A number unique to this run: +1956555 plus four digits of Date.now(), e.g. +19565551234 →
  // formatPhone's "(956) 555-1234" (apps/web/src/lib/document-requests/customer-state.ts:49-52).
  tag = String(Date.now()).slice(-4);
  number = `+1956555${tag}`;
  formattedNumber = `(956) 555-${tag}`;
  threadLabel = m["contact.holding.label"].replace("{number}", formattedNumber);

  const ana = await createContact(
    svc, accountId, { firstName: "Ana", lastName: "Prueba", phone: number, matchBy: "email_only" }, ACTOR,
  );
  anaId = ana.id;
  const beto = await createContact(
    svc, accountId, { firstName: "Beto", lastName: "Prueba", phone: number, matchBy: "email_only" }, ACTOR,
  );
  betoId = beto.id;

  const holding = await ensureHoldingContact(svc, accountId, number, "sms");
  holdingId = holding.id;
  const convo = await ensureConversation(svc, accountId, holdingId, ACTOR, "system");
  holdingConversationId = convo.id;
  const msg = await createMessage(svc, accountId, {
    conversationId: holdingConversationId, channel: "sms", direction: "inbound",
    body: `test ${tag}`, status: "delivered",
  }, ACTOR, "system");
  messageId = msg.id;
});

test.afterAll(async () => {
  // Best-effort: the per-run fixture account is itself removed by auth.teardown.ts regardless, but a
  // failed run must still say so rather than scroll past it (ai-disclosure.spec.ts:146-202's shape).
  if (!fixtureRef) return;
  const svc = serviceDb();
  const problems: string[] = [];
  const fail = (line: string) => { console.error(line); problems.push(line); };
  const step = async (what: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run();
    if (error) fail(`shared-number e2e cleanup: ${what} failed: ${error.message}`);
  };

  const ids = [anaId, betoId, holdingId].filter((id) => id.length > 0);
  if (ids.length > 0) {
    // Messages, then conversations, BEFORE deleteContacts: a conversation that still holds a message
    // is "not empty" and deleteContacts's own delete_empty_conversations leaves it (and the contact
    // that owns it) alone (packages/db/src/contacts.ts:1193-1202's own doc comment).
    try {
      const { data: convs, error: convErr } = await svc.from("conversations").select("id")
        .eq("account_id", accountId).in("contact_id", ids);
      if (convErr) fail(`shared-number e2e cleanup: conversations pre-read failed: ${convErr.message}`);
      const convIds = (convs ?? []).map((r) => r.id as string);
      if (convIds.length > 0) {
        await step("messages", () => svc.from("messages").delete().eq("account_id", accountId).in("conversation_id", convIds));
        await step("conversations", () => svc.from("conversations").delete().eq("account_id", accountId).in("id", convIds));
      }
    } catch (e) {
      fail(`shared-number e2e cleanup: reading/deleting conversations failed: ${String(e)}`);
    }
    try {
      const result = await deleteContacts(svc, accountId, ids, { serviceDb: svc });
      if (result.deleted !== ids.length) {
        fail(`shared-number e2e cleanup: deleteContacts deleted ${result.deleted} of ${ids.length} `
          + `(skippedBlocked ${result.skippedBlocked}, skippedFiles ${result.skippedFiles})`);
      }
    } catch (e) {
      fail(`shared-number e2e cleanup: deleteContacts threw: ${String(e)}`);
    }
  }

  // Re-read: none of the three ids remain, on either table. A `head: true` count's own failure shape
  // is `{ count: null, error: null }` — `count ?? 0` would read that as "zero, all clear" (memory
  // "Head-count null"), so a null is its own failure line, never folded into the zero case.
  if (ids.length > 0) {
    const contactsLeft = (await svc.from("contacts").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).in("id", ids)).count;
    if (contactsLeft === null) fail("shared-number e2e cleanup: contacts re-read failed (count null)");
    else if (contactsLeft !== 0) fail(`shared-number e2e cleanup: ${contactsLeft} of the three contacts still exist`);

    const convsLeft = (await svc.from("conversations").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).in("contact_id", ids)).count;
    if (convsLeft === null) fail("shared-number e2e cleanup: conversations re-read failed (count null)");
    else if (convsLeft !== 0) fail(`shared-number e2e cleanup: ${convsLeft} conversation row(s) still exist for these contacts`);
  }

  if (problems.length > 0) {
    throw new Error(`shared-number e2e cleanup left the fixture dirty:\n${problems.join("\n")}`);
  }
});

test("staff move a shared number's texts to the right person, and Undo moves them back", async ({ page }) => {
  test.skip(skipReason !== null, skipReason ?? "");

  await page.goto(`/dashboard/accounts/${accountId}/conversations?c=${holdingConversationId}`);

  const threadName = page.locator("[data-thread-name]");
  await expect(threadName).toHaveText(threadLabel);

  const notice = page.locator('[data-slot="notice"]');
  await expect(notice).toHaveText(m["conversation.holding.notice"].replace("{number}", formattedNumber));

  const inboxRow = page.locator(`[data-conversation-row="${holdingConversationId}"]`);
  await expect(inboxRow).toContainText(threadLabel);

  await page.locator("[data-holding-move]").click();
  await page.getByRole("menuitem", { name: "Beto Prueba", exact: true }).click();

  const movedToast = page.locator("[data-sonner-toast]")
    .filter({ hasText: m["conversation.holding.moved"].replace("{name}", "Beto Prueba") });
  await expect(movedToast).toBeVisible();

  // The URL's own `c` is Beto's conversation — read back off the client, since moveHoldingThreadAction
  // creates it on demand (there is no id to predict ahead of the click).
  await expect.poll(() => new URL(page.url()).searchParams.get("c")).not.toBe(holdingConversationId);
  const betoConversationId = new URL(page.url()).searchParams.get("c");
  if (!betoConversationId) throw new Error("shared-number e2e: no c= on the URL after the move");
  const svc = serviceDb();
  const { data: betoConvoRow, error: betoConvoErr } = await svc.from("conversations")
    .select("contact_id").eq("id", betoConversationId).single();
  if (betoConvoErr) throw new Error(`shared-number e2e: reading Beto's conversation failed: ${betoConvoErr.message}`);
  expect(betoConvoRow?.contact_id).toBe(betoId);
  // Scoped to the message BUBBLE's own paragraph (message-thread.tsx's `whitespace-pre-wrap` class),
  // never a bare getByText: the same words also sit in the inbox row's last-message preview span, and
  // a bare text locator hit both at once (strict-mode violation, caught on the first local run).
  await expect(page.locator("p.whitespace-pre-wrap", { hasText: `test ${tag}` })).toBeVisible();

  // Within the 10s Undo window (UNDO_WINDOW_MS) — a Playwright click lands in well under one second.
  await movedToast.getByRole("button", { name: m["common.undo"] }).click();

  await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["conversation.holding.movedBack"] })).toBeVisible();

  await expect.poll(async () => {
    const { data, error } = await svc.from("messages").select("conversation_id").eq("id", messageId).single();
    if (error) throw new Error(`shared-number e2e: polling the message's conversation_id failed: ${error.message}`);
    return data?.conversation_id;
  }, { timeout: 10_000 }).toBe(holdingConversationId);
});

test("the holding record is not a customer: it never lists as a contact, and its own page opens the thread", async ({ page }) => {
  test.skip(skipReason !== null, skipReason ?? "");

  await page.goto(`/dashboard/accounts/${accountId}/contacts?q=${tag}`);
  await expect(page.locator(`[data-contact-row="${anaId}"]`)).toContainText("Ana Prueba");
  await expect(page.locator(`[data-contact-row="${betoId}"]`)).toContainText("Beto Prueba");
  await expect(page.locator(`[data-contact-row="${holdingId}"]`)).toHaveCount(0);
  await expect(page.getByRole("row", { name: "Caller" })).toHaveCount(0);

  // Its record page is not a record at all — redirect.ts carries it straight to the thread
  // ([accountId]/contacts/[contactId]/page.tsx: `if (contact.holds_shared_number) redirect(...)`).
  await page.goto(`/dashboard/accounts/${accountId}/contacts/${holdingId}`);
  await expect(page).toHaveURL(new RegExp(`/conversations\\?c=${holdingConversationId}$`));
});
