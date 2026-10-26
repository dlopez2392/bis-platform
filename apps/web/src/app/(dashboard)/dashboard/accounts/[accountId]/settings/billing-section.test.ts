import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactElement } from "react";
import type { AccountBilling, Plan } from "@bis/db";
import type { BillingCardView } from "@/lib/billing/billing-view";

const dbm = vi.hoisted(() => ({
  getAccountBilling: vi.fn(), getBillingLink: vi.fn(), listPlans: vi.fn(), sumUsageSince: vi.fn(), listReconciliations: vi.fn(),
  account: { timezone: "America/Chicago", reply_to_email: null as string | null, report_emails: ["boss@example.com"] },
  requestDb: { tag: "request" },
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAccountBilling: dbm.getAccountBilling, getBillingLink: dbm.getBillingLink, listPlans: dbm.listPlans, sumUsageSince: dbm.sumUsageSince,
  listReconciliations: dbm.listReconciliations,
  serviceDb: () => ({
    tag: "service",
    from: () => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: dbm.account, error: null }) }; return c; },
  }),
}));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => dbm.requestDb }));
const guard = vi.hoisted(() => ({ requireAgency: vi.fn(async () => ({ userId: "u" })) }));
vi.mock("@/lib/auth", () => guard);
const actionsm = vi.hoisted(() => ({
  liftPauseAction: vi.fn(async () => ({ ok: true as const, liftedAt: "2026-10-20T00:00:00.000Z", pausedAt: "2026-10-13T00:00:00.000Z" })),
  undoLiftPauseAction: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("./billing-actions", () => ({
  sendBillingLinkAction: async () => ({ ok: true }), markComplimentaryAction: async () => ({ ok: true }),
  removeComplimentaryAction: async () => ({ ok: true }), changePlanAction: async () => ({ ok: true }),
  liftPauseAction: actionsm.liftPauseAction, undoLiftPauseAction: actionsm.undoLiftPauseAction,
}));

const { BillingSection, BillingCardError } = await import("./billing-section");
const { BillingCard } = await import("./billing-card");

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(path.join(here, ...p), "utf8");

const PLAN = { id: "p1", agencyId: "ag", name: "Growth", monthlyPriceCents: 14900, currency: "usd",
  features: { voice_receptionist: true, web_concierge: true }, allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
  overageCents: { voice_minutes: 10, sms: 3, ai_chats: 25 }, stripeProductId: "prod_1",
  stripePriceIds: { base: "price_b", voice_minutes: "price_v", sms: "price_s", ai_chats: "price_a" },
  archivedAt: null, createdAt: "", updatedAt: "" } as Plan;
const BILLED = { accountId: "a", planId: "p1", complimentary: false, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1",
  subscriptionStatus: "active", currentPeriodStart: "2026-10-12T17:00:00+00:00", currentPeriodEnd: "2026-11-12T17:00:00+00:00",
  pastDueSince: null, billingPausedAt: null, pauseLiftedAt: null, stripeCheckedAt: null, billingStartedAt: "", createdAt: "", updatedAt: "" } as AccountBilling;

beforeEach(() => {
  for (const f of [dbm.getAccountBilling, dbm.getBillingLink, dbm.listPlans, dbm.sumUsageSince, dbm.listReconciliations]) f.mockReset();
  dbm.getBillingLink.mockResolvedValue(null);
  dbm.listPlans.mockResolvedValue([PLAN]);
  dbm.sumUsageSince.mockResolvedValue({ voice_minutes: 312, sms: 0, ai_chats: 0 });
  dbm.listReconciliations.mockResolvedValue([]);
  dbm.account = { timezone: "America/Chicago", reply_to_email: null, report_emails: ["boss@example.com"] };
  actionsm.liftPauseAction.mockClear();
  actionsm.undoLiftPauseAction.mockClear();
  vi.unstubAllEnvs();
});

describe("BillingSection", () => {
  it("reads the service-role tables (billing_links, plans, usage) through serviceDb and counts usage from Stripe's period start (mutation: count from the 1st → FAILS; read billing_links on the request client → RLS returns nothing, FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(BILLED);
    const el = (await BillingSection({ accountId: "a" })) as ReactElement<{ view: { usage: { text: string }[] } }>;
    expect(isValidElement(el) && el.type).toBe(BillingCard);
    expect(dbm.getBillingLink.mock.calls[0]![0]).toMatchObject({ tag: "service" });
    expect(dbm.listPlans.mock.calls[0]![0]).toMatchObject({ tag: "service" });
    expect(dbm.sumUsageSince).toHaveBeenCalledWith(expect.objectContaining({ tag: "service" }), "a", "2026-10-12T17:00:00.000Z");
    expect(el.props.view.usage[0]!.text).toBe("312 of 500 minutes");
  });

  it("reads the account's billing row through the request-cached readAccountBilling (the account layout's banner read, Task 10), never a second getAccountBilling of its own (mutation: call getAccountBilling(serviceDb(), …) in the section → a second query per Settings visit, FAILS; drop cache() from the reader → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(BILLED);
    await BillingSection({ accountId: "a" });
    expect(dbm.getAccountBilling.mock.calls).toEqual([[dbm.requestDb, "a"]]);
    // React's cache() only dedupes inside a server request, which vitest does
    // not have, so the sharing itself is pinned on the source.
    const reader = read("..", "..", "..", "..", "..", "..", "lib", "billing", "account-billing-read.ts");
    expect(reader).toMatch(/export const readAccountBilling = cache\(/);
    const section = read("billing-section.tsx");
    expect(section).toContain("readAccountBilling(");
    expect(section).not.toMatch(/\bgetAccountBilling\(/);
  });

  it("pre-fills the recipient with the reply-to address, else the first weekly-report address (G18) (mutation: always blank → FAILS; prefer the report address → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(null);
    const el = (await BillingSection({ accountId: "a" })) as ReactElement<{ view: { defaultEmail: string } }>;
    expect(el.props.view.defaultEmail).toBe("boss@example.com");
    dbm.account = { ...dbm.account, reply_to_email: "office@example.com" };
    const el2 = (await BillingSection({ accountId: "a" })) as ReactElement<{ view: { defaultEmail: string } }>;
    expect(el2.props.view.defaultEmail).toBe("office@example.com");
  });

  it("guards itself: requireAgency runs before ANY billing read, and its redirect is not swallowed into the error card, so a future mount outside agency-only Settings cannot leak billing (review M-8) (mutation: drop the guard → FAILS; put it inside the try → the redirect becomes an error card, FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(null);
    guard.requireAgency.mockClear();
    await BillingSection({ accountId: "a" });
    expect(guard.requireAgency).toHaveBeenCalledOnce();
    expect(guard.requireAgency.mock.invocationCallOrder[0]!).toBeLessThan(dbm.getBillingLink.mock.invocationCallOrder[0]!);

    for (const f of [dbm.getAccountBilling, dbm.getBillingLink, dbm.listPlans, dbm.sumUsageSince]) f.mockClear();
    guard.requireAgency.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(BillingSection({ accountId: "a" })).rejects.toThrow("NEXT_REDIRECT");
    for (const f of [dbm.getAccountBilling, dbm.getBillingLink, dbm.listPlans, dbm.sumUsageSince]) expect(f).not.toHaveBeenCalled();
  });

  it("a failed read renders the error card and logs; it never takes Settings (and its client-access switch) offline (mutation: let the error propagate → FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    dbm.getAccountBilling.mockRejectedValue(new Error("getAccountBilling failed: timeout"));
    const el = (await BillingSection({ accountId: "a" })) as ReactElement;
    expect(isValidElement(el) && el.type).toBe(BillingCardError);
    expect(log.mock.calls.flat().join(" ")).toContain("timeout");
    log.mockRestore();
  });

  it("logs the failed read through loggableError, so an address in the error never reaches the logs (the rest of billing's rule; found while closing final review m3) (mutation: log e.message raw → FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    dbm.getAccountBilling.mockRejectedValue(new Error("read failed near owner@example.com"));
    await BillingSection({ accountId: "a" });
    expect(log.mock.calls.flat().join(" ")).toBe("settings: billing card unavailable for account a: Error: read failed near [email]");
    log.mockRestore();
  });
});

describe("BillingSection: what the card may offer is read from THIS deployment's env (final review I1, m2)", () => {
  // A usable TEST key on the CI project's database (stripeKeyVerdict), and a
  // webhook signing secret. Each test below takes one of them away.
  const usable = () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_section_fixture");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://odnobiodsftffphuuosz.supabase.co");
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_section_fixture");
  };
  const viewOf = async () => ((await BillingSection({ accountId: "a" })) as ReactElement<{ view: BillingCardView }>).props.view;
  beforeEach(() => { dbm.getAccountBilling.mockResolvedValue(null); usable(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("with a usable key AND the webhook secret, an unbilled account is offered Send (mutation: hard-code webhookReady: false → FAILS)", async () => {
    const view = await viewOf();
    expect({ stripeReady: view.stripeReady, webhookReady: view.webhookReady, send: view.can.send })
      .toEqual({ stripeReady: true, webhookReady: true, send: true });
  });

  it("without STRIPE_WEBHOOK_SECRET the card is not ready to send, though the key is fine (mutation: read only the key → FAILS; hard-code webhookReady: true → FAILS)", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", undefined);
    const view = await viewOf();
    expect({ stripeReady: view.stripeReady, webhookReady: view.webhookReady, send: view.can.send })
      .toEqual({ stripeReady: true, webhookReady: false, send: false });
  });

  it("a whitespace-only STRIPE_WEBHOOK_SECRET counts as unset, trimmed exactly as the webhook route trims it (mutation: drop the trim in webhookSecretFromEnv → FAILS)", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", " \n ");
    const view = await viewOf();
    expect({ webhookReady: view.webhookReady, send: view.can.send }).toEqual({ webhookReady: false, send: false });
  });

  it("without a usable Stripe key the card is not stripeReady and offers no Send (probe M14: hard-code stripeReady: true → FAILS)", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", undefined);
    const view = await viewOf();
    expect({ stripeReady: view.stripeReady, send: view.can.send }).toEqual({ stripeReady: false, send: false });
  });
});

describe("BillingSection: Lift pause, reconciliation and the enforced switch (Task 11)", () => {
  it("binds Lift pause and its Undo to THIS account's id, server-side — the id never travels as a form field (mutation: call the actions without accountId → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(BILLED);
    const el = (await BillingSection({ accountId: "acct-x" })) as ReactElement<{ liftPause: () => Promise<unknown>; undoLiftPause: (l: string, p: string) => Promise<unknown> }>;
    await el.props.liftPause();
    expect(actionsm.liftPauseAction).toHaveBeenCalledWith("acct-x");
    await el.props.undoLiftPause("2026-10-20T00:00:00.000Z", "2026-10-13T00:00:00.000Z");
    expect(actionsm.undoLiftPauseAction).toHaveBeenCalledWith("acct-x", "2026-10-20T00:00:00.000Z", "2026-10-13T00:00:00.000Z");
  });

  it("every function prop the card gets is a BOUND server action (Function.prototype.bind), never a closure — a closure is not serializable to the client card and blanked Settings (30f77d01, otherwise caught only by e2e) (mutation: undoLiftPause={(l, p) => undoLiftPauseAction(accountId, l, p)} → FAILS by its name)", async () => {
    dbm.getAccountBilling.mockResolvedValue(BILLED);
    const el = (await BillingSection({ accountId: "a" })) as ReactElement<Record<string, unknown>>;
    const fns = Object.entries(el.props).filter(([, v]) => typeof v === "function");
    expect(fns.map(([k]) => k).sort()).toEqual(
      ["changePlan", "liftPause", "markComplimentary", "send", "stopComplimentary", "undoLiftPause"],
    );
    for (const [k, fn] of fns) expect((fn as () => unknown).name, k).toMatch(/^bound /);
  });

  it("a failed reconciliation read alone does not blank the card: Lift pause stays, and the card says it couldn't check (design review I2) (mutation: leave listReconciliations in the all-or-nothing Promise.all → FAILS: the error card renders)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    dbm.getAccountBilling.mockResolvedValue({ ...BILLED, subscriptionStatus: "past_due", billingPausedAt: "2026-10-13T00:00:00+00:00", pastDueSince: "2026-10-01T00:00:00+00:00" });
    dbm.listReconciliations.mockRejectedValue(new Error("listReconciliations failed: timeout"));
    const el = (await BillingSection({ accountId: "a" })) as ReactElement<{ view: BillingCardView }>;
    expect(isValidElement(el) && el.type).toBe(BillingCard);
    expect(el.props.view.can.liftPause).toBe(true);
    expect(el.props.view.reconciliation).toEqual([]);
    expect(el.props.view.reconciliationUnchecked).toBe(true);
    expect(log.mock.calls.flat().join(" ")).toContain("timeout");
    log.mockRestore();
    // A good read says nothing of the kind.
    dbm.listReconciliations.mockResolvedValue([]);
    const ok = (await BillingSection({ accountId: "a" })) as ReactElement<{ view: BillingCardView }>;
    expect(ok.props.view.reconciliationUnchecked).toBe(false);
  });

  it("reads this account's reconciliation rows (listReconciliations) and feeds them into the card's reconciliation lines (mutation: pass [] always → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(BILLED);
    dbm.listReconciliations.mockResolvedValue([{
      accountId: "a", meter: "voice_minutes", windowStart: "2026-10-01T00:00:00.000Z", windowEnd: "2026-10-20T00:00:00.000Z",
      bisSettled: 480, bisInFlight: 0, bisHeld: 0, stripeTotal: 500, verdict: "stripe_over", checkedAt: "2026-10-20T08:00:00.000Z",
    }]);
    const el = (await BillingSection({ accountId: "a" })) as ReactElement<{ view: { reconciliation: string[] } }>;
    expect(dbm.listReconciliations.mock.calls[0]!.slice(1)).toEqual(["a", expect.anything()]);
    expect(el.props.view.reconciliation).toHaveLength(1);
    expect(el.props.view.reconciliation[0]).toContain("Stripe counts 500");
    expect(el.props.view.reconciliation[0]).toContain("BIS counts 480");
  });

  it("the card's `enforced` comes from billingEnforced() — never hard-coded (mutation: hard-code enforced: true → FAILS; mutation: hard-code enforced: false → FAILS)", async () => {
    // 35 days ago (not a fixed date): past PAUSE_FORWARD_MS's 30-day line
    // regardless of which day this runs, the same reasoning as the work
    // page's own clock-derived tests.
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    const pausedRow = { ...BILLED, subscriptionStatus: "past_due" as const, billingPausedAt: thirtyFiveDaysAgo, pastDueSince: thirtyFiveDaysAgo };
    dbm.getAccountBilling.mockResolvedValue(pausedRow);

    vi.stubEnv("BILLING_ENFORCE", "1");
    const enforcedEl = (await BillingSection({ accountId: "a" })) as ReactElement<{ view: { pause: { noForward: string | null } | null; pauseOff: boolean } }>;
    expect(enforcedEl.props.view.pause?.noForward).not.toBeNull();
    expect(enforcedEl.props.view.pauseOff).toBe(false);

    vi.stubEnv("BILLING_ENFORCE", undefined);
    const offEl = (await BillingSection({ accountId: "a" })) as ReactElement<{ view: { pause: { noForward: string | null } | null; pauseOff: boolean } }>;
    expect(offEl.props.view.pause?.noForward ?? null).toBeNull();
    expect(offEl.props.view.pauseOff).toBe(true);
  });
});
