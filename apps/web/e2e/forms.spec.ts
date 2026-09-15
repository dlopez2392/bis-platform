import { test, expect, type Page } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { serviceDb } from "@bis/db";

// Playwright's config passes env to the webServer, not to this process, so the
// service-role credentials have to be loaded explicitly for setup and cleanup.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// Pinned by name, not position — same reasoning as messaging.spec.ts: "first
// card" on /dashboard/accounts broke once stray accounts existed alongside the
// seeded one.
const ACCOUNT_NAME = "Test Client One";

// Both specs drive the whole loop — build a form, publish it, submit it as a
// stranger, read the lead back on three screens — against a dev server that
// compiles each route on first hit, and they deliberately wait out the 2s
// fill-time guard. That lands at ~30s, so the default 30s budget makes a pass
// or a failure depend on compile luck rather than on the product: this file
// timed out on one run and passed the next with no code change between them.
test.describe.configure({ timeout: 120_000 });

// Runs in a `finally`, not at the end of the test body. A failure partway
// through leaves a stray contact in the shared dev database, and the very next
// spec — contact-detail.spec, which opens "the first contact in the table" —
// then fails for reasons that have nothing to do with it. That is not
// hypothetical: it is what happened the first time this spec failed.
async function purge(formName: string, leadEmail: string): Promise<void> {
  const db = serviceDb();
  const { data: forms } = await db.from("forms").select("id").eq("name", formName);
  for (const form of forms ?? []) {
    await db.from("form_submissions").delete().eq("form_id", form.id);
    await db.from("forms").delete().eq("id", form.id);
  }
  const { data: contacts } = await db.from("contacts").select("id").eq("email", leadEmail);
  for (const contact of contacts ?? []) {
    const { data: convos } = await db.from("conversations").select("id")
      .eq("contact_id", contact.id);
    for (const convo of convos ?? []) {
      await db.from("messages").delete().eq("conversation_id", convo.id);
      await db.from("conversations").delete().eq("id", convo.id);
    }
    await db.from("contacts").delete().eq("id", contact.id);
  }
}

// The status control is a Radix Select (a combobox), not the radio group the
// plan assumed — Task 7's review replaced the radios.
async function publish(page: Page): Promise<string> {
  const editorUrl = page.url();

  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Published" }).click();
  await page.getByRole("button", { name: "Save" }).click();

  // Wait for the editor's OWN success toast, which is what "the save landed"
  // actually means, and give it the describe block's budget rather than the
  // 10s default. This file already documents why: it runs against a dev
  // server that compiles each route on first hit, and the timeout at the top
  // was raised to 120s for exactly that. But a describe timeout does not
  // cover an `expect` — so the assertions inside kept the 10s default, and
  // this one sat right on the boundary. A trace from a failed run shows the
  // sibling test passing the same helper in 17.9s.
  await expect(page.getByText("Saved", { exact: true }))
    .toBeVisible({ timeout: 30_000 });

  // Then read the link off a FRESH load of the editor.
  //
  // Not paranoia: on the run that produced that trace, the page at failure
  // was the forms LIST, with the form correctly marked Published. The save
  // had landed; the direct link simply only renders on the editor, and
  // `saveForm` revalidates BOTH paths. Re-loading removes the question of
  // where the router settled.
  //
  // This is a STRONGER assertion than the in-place one it replaces — a fresh
  // load proves the published status came back from the server, not from
  // optimistic state still sitting in the client.
  await page.goto(editorUrl);

  const link = page.getByRole("link", { name: /\/f\// });
  await expect(link).toBeVisible({ timeout: 30_000 });
  const href = await link.getAttribute("href");
  expect(href, "a published form must expose a direct link").toBeTruthy();
  return new URL(href!).pathname;
}

// Adds a consent checkbox and renames it to something unique per run. The label
// is what gets stored as the consent TEXT on every submission, so a unique one
// is what lets the assertion prove the STORED copy came back, rather than
// matching some other element that happens to say "consent".
async function addConsentField(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "Consent checkbox" }).click();
  await page.getByLabel("Label — consent").fill(label);
}

async function newPublishedForm(
  page: Page, formName: string, consentLabel?: string,
): Promise<string> {
  await page.goto("/dashboard/accounts");
  await page.getByRole("link", { name: new RegExp(ACCOUNT_NAME, "i") }).first().click();
  await expect(page).toHaveURL(/\/contacts$/);

  await page.getByRole("link", { name: "Forms" }).click();
  await expect(page).toHaveURL(/\/forms$/);

  await page.getByRole("button", { name: "New form" }).click();
  await page.getByLabel("Form name").fill(formName);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);

  if (consentLabel) await addConsentField(page, consentLabel);

  return publish(page);
}

test("a published form captures a lead into the CRM", async ({ page }) => {
  // Unique per run: this writes real rows to the shared dev database, and the
  // marker both scopes cleanup and stops assertions matching a row that a
  // crashed earlier run left behind.
  const stamp = Date.now();
  const formName = `E2E Form ${stamp}`;
  const leadName = `E2E Lead ${stamp}`;
  const leadEmail = `e2e-${stamp}@example.com`;
  const messageBody = `Deck quote please (${stamp}).`;

  const consentLabel = `I agree to be contacted (${stamp})`;

  try {
    const publicPath = await newPublishedForm(page, formName, consentLabel);
    const editorUrl = page.url();
    const accountId = new URL(editorUrl).pathname.split("/")[3]!;

    // --- The public side, as a stranger -------------------------------
    await page.goto(publicPath);
    await page.getByLabel("Name").fill(leadName);
    await page.getByLabel("Email").fill(leadEmail);
    await page.getByLabel(/How can we help/).fill(messageBody);
    await page.getByLabel(consentLabel).check();

    // The fill-time guard rejects anything faster than MIN_FILL_MS (2s), and a
    // rejected submission is indistinguishable from success — so a spec that
    // submitted immediately would pass while creating nothing.
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("status")).toContainText(/thank you/i);

    // --- Back inside, the lead must be visible -------------------------
    await page.goto(`/dashboard/accounts/${accountId}/conversations`);
    const thread = page.getByRole("link").filter({ hasText: leadName });
    await expect(thread).toBeVisible();
    await expect(thread.getByLabel(/unread/)).toBeVisible();

    // The submission's contact and conversation, looked up once and reused
    // below — for the DB-level wait on the read state further down, and for
    // the contact's own timeline at the end of this test.
    const { data: contact } = await serviceDb()
      .from("contacts").select("id").eq("email", leadEmail).single();
    expect(contact, "the submission must have created a contact").toBeTruthy();
    const { data: convoRow } = await serviceDb()
      .from("conversations").select("id")
      .eq("account_id", accountId).eq("contact_id", contact!.id).single();
    expect(convoRow, "the submission must have opened a conversation").toBeTruthy();

    // Task 8's whole reason for marking read in an effect instead of during the
    // render: Next prefetches <Link> targets, so a render-time write would
    // clear the badge on hover alone. Hover, let the prefetch land, reload —
    // the badge must survive.
    await thread.hover();
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(
      page.getByRole("link").filter({ hasText: leadName }).getByLabel(/unread/),
      "hovering a thread must not mark it read",
    ).toBeVisible();

    await page.getByRole("link").filter({ hasText: leadName }).click();
    await expect(page.getByText(messageBody).first()).toBeVisible();

    // Scoped to this message's own bubble, not the page: the thread list
    // renders every conversation's preview, so a page-wide search for "Sent"
    // matches an unrelated thread whose last message was an outbound email.
    // `.last()` is the innermost matching div — ancestors come first in
    // document order — which is the bubble itself.
    const bubble = page.locator("div").filter({ hasText: messageBody }).last();
    // The contact's own words must never be labelled "Note", and an inbound
    // message has no delivery status to report.
    await expect(bubble).toContainText("Form submission");
    await expect(bubble).not.toContainText("Sent");

    // Opening it for real does clear the count — but mark-read.tsx fires the
    // clearing write fire-and-forget (an effect, `void action(...)`,
    // deliberately unawaited: it exists specifically so a hover's Link
    // prefetch can never trigger a read). Nothing on this page tells the
    // test when that request's own server round trip lands, and leaving via
    // `page.goto` is a REAL navigation — proven, not assumed, to abort a
    // still-in-flight fetch from the page being left (see
    // forms-flake-report.md: with every POST on this page delayed 4s,
    // navigating away and then re-navigating in a retry loop never saw the
    // count clear, because the FIRST departure killed the write in flight;
    // staying put for the same 4s and navigating once afterward passed every
    // time). So wait on the row itself — the same table the UI reads from —
    // before leaving this page at all, rather than trusting one snapshot,
    // padding a guessed delay, or "retrying" a navigation that would only
    // repeat the kill.
    await expect
      .poll(async () => {
        const { data } = await serviceDb()
          .from("conversations").select("unread_count").eq("id", convoRow!.id).single();
        return data?.unread_count ?? null;
      }, "the mark-read write must actually land before this page is left")
      .toBe(0);

    await page.goto(`/dashboard/accounts/${accountId}/conversations`);
    await expect(
      page.getByRole("link").filter({ hasText: leadName }).getByLabel(/unread/),
    ).toHaveCount(0);

    // --- And on the contact's own timeline -----------------------------
    await page.goto(`/dashboard/accounts/${accountId}/contacts/${contact!.id}`);
    await expect(page.getByText(formName).first()).toBeVisible();
    await expect(page.getByText(messageBody).first()).toBeVisible();

    // --- And the consent copy is readable back -------------------------
    // The pipeline stores the exact wording the person agreed to so it can be
    // produced on request. That is only true if it renders: it lives on the
    // form's submissions list. getByText does not match an input's VALUE, so
    // the editor's own label field above it cannot satisfy this.
    await page.goto(editorUrl);
    await expect(page.getByText(consentLabel)).toBeVisible();
  } finally {
    // Only this run's rows, in FK order. The seeded account, its contacts and
    // its opportunities must all survive.
    await purge(formName, leadEmail);
  }
});

test("a honeypot submission looks like success and creates nothing", async ({ page }) => {
  const stamp = Date.now();
  const formName = `E2E Spam ${stamp}`;
  const leadEmail = `e2e-spam-${stamp}@example.com`;

  try {
    const publicPath = await newPublishedForm(page, formName);

    await page.goto(publicPath);
    await page.getByLabel("Name").fill("Bot");
    await page.getByLabel("Email").fill(leadEmail);
    // The trap. A human never sees this field — it is positioned off-screen
    // rather than display:none precisely so a bot will find and fill it.
    await page.locator("#bis_hp").fill("http://spam.example");
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Submit" }).click();

    // Identical to the honest path on purpose: telling a bot which guard fired
    // is free tuning information.
    await expect(page.getByRole("status")).toContainText(/thank you/i);

    const db = serviceDb();
    const { data: form } = await db.from("forms").select("id").eq("name", formName).single();
    const { data: rows } = await db.from("form_submissions")
      .select("spam_reason, contact_id").eq("form_id", form!.id);
    expect(rows).toHaveLength(1);
    expect(rows![0]!.spam_reason).toBe("honeypot");
    expect(rows![0]!.contact_id).toBeNull();

    const { data: contact } = await db.from("contacts").select("id").eq("email", leadEmail);
    expect(contact, "a blocked submission must not create a contact").toHaveLength(0);
  } finally {
    await purge(formName, leadEmail);
  }
});
