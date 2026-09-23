import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * What is under test here is ONE thing: whether the client's own Branding
 * page threads the send-readiness gate (`resolveSmsSender`, the SAME
 * predicate the Settings page already reads for the agency's copy of this
 * card) into `AlertPhoneCard`'s `smsNotReady` prop.
 *
 * The defect this pins: the page computed only the stored number and never
 * the readiness check, so the card asserted "Alert texts go to {number}" in
 * the present tense even when an agency had saved a number but never
 * completed the registration that makes sending possible — a client reading
 * a capability the product has not actually verified. DESIGN.md's own
 * weekly-report doctrine: something not measured is omitted, never asserted.
 *
 * `AlertPhoneCard` itself is stubbed to capture its props rather than
 * rendered for real — its own internal copy selection is pinned by
 * alert-phone-card.test.ts's source-text checks, so re-asserting that here
 * would duplicate coverage rather than add it (same reasoning voice/
 * page.test.ts gives for stubbing VoiceSettings).
 */
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: false }),
}));

const dbFixture = vi.hoisted(() => ({
  alertPhone: null as string | null,
  mailingAddress: null as string | null,
  /** The one object serviceDb() hands out, so a read can be traced to it. */
  service: { tag: "serviceDb" },
  mailingReads: [] as unknown[][],
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => dbFixture.service,
  getBranding: async () => ({
    brandName: null, brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
  }),
  getAlertPhone: async () => dbFixture.alertPhone,
  getMailingAddress: async (...args: unknown[]) => {
    dbFixture.mailingReads.push(args);
    return dbFixture.mailingAddress;
  },
  brandLogoUrl: (p: string) => `https://example.test/${p}`,
}));

const gateFixture = vi.hoisted(() => ({ ok: true }));
vi.mock("@/lib/sms/sender", () => ({
  resolveSmsSender: async () =>
    (gateFixture.ok
      ? { ok: true, from: "+15550000000", ownedNumbers: ["+15550000000"] }
      : { ok: false, reason: "a2p_not_approved" }),
}));

const captured = vi.hoisted(() => ({
  props: null as { alertPhone: string | null; smsNotReady?: boolean } | null,
  panel: null as { mailingAddress?: string | null } | null,
}));
vi.mock("@/components/branding-panel", () => ({
  BrandingPanel: (props: { mailingAddress?: string | null }) => {
    captured.panel = props;
    return null;
  },
}));
vi.mock("@/components/alert-phone-card", () => ({
  AlertPhoneCard: (props: { alertPhone: string | null; smsNotReady?: boolean }) => {
    captured.props = props;
    return null;
  },
}));

// "use server" — cannot be imported into a vitest render.
vi.mock("./actions", () => ({ setBrandingAction: async () => ({ ok: true }) }));

const { default: BrandingPage } = await import("./page");

async function render() {
  captured.props = null;
  captured.panel = null;
  const el = await BrandingPage({
    params: Promise.resolve({ accountId: "a1" }),
    searchParams: Promise.resolve({}),
  });
  renderToStaticMarkup(el);
  return captured.props!;
}

beforeEach(() => {
  dbFixture.alertPhone = "+19562921696";
  dbFixture.mailingAddress = null;
  dbFixture.mailingReads = [];
  gateFixture.ok = true;
});

describe("branding page — the mailing address field", () => {
  it("hands the panel the stored address, read through serviceDb() like getBranding (mutation: pass mailingAddress={null} → FAILS)", async () => {
    dbFixture.mailingAddress = "123 Main St\nMcAllen, TX 78501";
    await render();
    expect(captured.panel?.mailingAddress).toBe("123 Main St\nMcAllen, TX 78501");
    // The same client the page's own comment says every read of this row
    // uses — not a second, differently-privileged path.
    expect(dbFixture.mailingReads).toEqual([[dbFixture.service, "a1"]]);
  });

  it("hands the panel null when none is stored, so the box renders empty (mutation: pass \"\" → FAILS)", async () => {
    await render();
    expect(captured.panel).not.toBeNull();
    expect(captured.panel?.mailingAddress).toBeNull();
  });
});

describe("branding page — alert-phone readiness", () => {
  it("passes smsNotReady=false to AlertPhoneCard when the send gate is clear", async () => {
    gateFixture.ok = true;
    const props = await render();
    expect(props.smsNotReady).toBe(false);
  });

  it("passes smsNotReady=true when the send gate is not clear, so the client view never claims a working destination (mutation: drop the resolveSmsSender wiring → FAILS)", async () => {
    gateFixture.ok = false;
    const props = await render();
    expect(props.smsNotReady).toBe(true);
  });

  it("passes smsNotReady=true when the gate is otherwise clear but the stored alert phone matches one of the account's own owned numbers — the widened send-side loop definition, not just gate.ok (mutation: check only !smsGate.ok → FAILS)", async () => {
    gateFixture.ok = true;
    // Matches the mocked resolveSmsSender's ownedNumbers list above, even
    // though the gate itself reports ok (a live number exists to send from).
    dbFixture.alertPhone = "+15550000000";
    const props = await render();
    expect(props.smsNotReady).toBe(true);
  });
});
