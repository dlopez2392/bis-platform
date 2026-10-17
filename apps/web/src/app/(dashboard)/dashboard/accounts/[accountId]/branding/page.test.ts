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
// requireNotTechnician's real shapes (lib/auth.ts): an Owner manages, staff does not.
const accessFixture = vi.hoisted(() => ({
  access: { userId: "user_1", isAgency: false, role: "staff" as string | null, canManage: false },
}));
vi.mock("@/lib/auth", () => ({
  requireNotTechnician: async () => accessFixture.access,
}));
// getPersonPrefs reads Clerk; the person here has no language of their own.
vi.mock("@/lib/preferences/person-prefs", () => ({
  getPersonPrefs: async () => ({ language: null, theme: null }),
}));

const dbFixture = vi.hoisted(() => ({
  alertPhone: null as string | null,
  mailingAddress: null as string | null,
  /** The one object serviceDb() hands out, so a read can be traced to it. */
  service: {
    tag: "serviceDb",
    // The page's one inline read: this account's language (S-06 part 2's list renders in it).
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (col: string, id: string) => ({
          maybeSingle: async () => {
            dbFixture.languageReads.push([table, cols, col, id]);
            if (dbFixture.languageError) return { data: null, error: dbFixture.languageError };
            return { data: { language: dbFixture.accountLanguage }, error: null };
          },
        }),
      }),
    }),
  },
  accountLanguage: null as string | null,
  languageError: null as { code: string; message: string } | null,
  languageReads: [] as unknown[][],
  neverLogReads: [] as unknown[][],
  neverLogFails: false,
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
  getInboundSettings: async () => ({ mode: "off", domain: null }),
  // S-06 part 2: answers for the account asked, the only rows the service read scoped to it returns.
  listNeverLog: async (...args: unknown[]) => {
    dbFixture.neverLogReads.push(args);
    if (dbFixture.neverLogFails) throw new Error("listNeverLog failed: boom");
    return [{ id: "n1", pattern: "billing@supplier.com", kind: "address", addedBy: "user_1", createdAt: "2026-10-16T00:00:00.000Z" }];
  },
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
vi.mock("../never-log-actions", () => ({
  addNeverLogAction: async () => ({ ok: false, error: "failed" }),
  removeNeverLogAction: async () => ({ ok: false, error: "failed" }),
}));
vi.mock("./actions", () => ({
  setBrandingAction: async () => ({ ok: true }),
  removeBrandLogoAction: async () => ({ ok: true, path: "acct/logo.png" }),
  restoreBrandLogoAction: async () => ({ ok: true }),
}));

const { default: BrandingPage } = await import("./page");

let lastHtml = "";

async function render(search: { from?: string; locale?: string } = {}) {
  captured.props = null;
  captured.panel = null;
  const el = await BrandingPage({
    params: Promise.resolve({ accountId: "a1" }),
    searchParams: Promise.resolve(search),
  });
  lastHtml = renderToStaticMarkup(el);
  return captured.props!;
}

beforeEach(() => {
  dbFixture.alertPhone = "+19562921696";
  dbFixture.mailingAddress = null;
  dbFixture.mailingReads = [];
  gateFixture.ok = true;
  accessFixture.access = { userId: "user_1", isAgency: false, role: "staff", canManage: false };
  dbFixture.accountLanguage = null;
  dbFixture.languageError = null;
  dbFixture.languageReads = [];
  dbFixture.neverLogReads = [];
  dbFixture.neverLogFails = false;
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

describe("branding page — the Never record card (S-06 part 2; plan G8)", () => {
  const OWNER = { userId: "user_1", isAgency: false, role: "owner", canManage: true };

  it("an Owner sees the list, read on serviceDb() for THIS account (mutation: drop the list card → FAILS)", async () => {
    accessFixture.access = OWNER;
    await render();
    expect(lastHtml).toContain("data-never-log=\"\"");
    expect(lastHtml).toContain('data-never-log-entry="billing@supplier.com"');
    expect(lastHtml).toContain('id="never-record"');
    expect(dbFixture.neverLogReads).toEqual([[dbFixture.service, "a1"]]);
    expect(dbFixture.languageReads).toEqual([["accounts", "language", "id", "a1"]]);
  });

  it("staff sees no list and nothing is read for them (mutation: drop the canManage gate → FAILS twice)", async () => {
    accessFixture.access = { userId: "user_1", isAgency: false, role: "staff", canManage: false };
    await render();
    expect(lastHtml).not.toContain("data-never-log");
    expect(dbFixture.neverLogReads).toEqual([]);
    expect(dbFixture.languageReads).toEqual([]);
  });

  it("an Owner whose account reads Spanish gets the list in Spanish, lang=es (mutation: pass locale=\"en\" → FAILS)", async () => {
    accessFixture.access = OWNER;
    dbFixture.accountLanguage = "es";
    await render();
    expect(lastHtml).toContain('lang="es"');
    const { renderedText } = await import("@/lib/rendered-text");
    const text = renderedText(lastHtml);
    expect(text).toContain("No registrar nunca");
    expect(text).toContain("Dirección o dominio");
  });

  it("an Owner on an English account reads English, lang=en", async () => {
    accessFixture.access = OWNER;
    await render();
    expect(lastHtml).toContain('lang="en"');
    const { renderedText } = await import("@/lib/rendered-text");
    expect(renderedText(lastHtml)).toContain("Never record");
  });

  it("a failed read is the list's own error state; the rest of the page still renders (mutation: drop the rejection handler → the page throws, FAILS)", async () => {
    accessFixture.access = OWNER;
    dbFixture.neverLogFails = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const props = await render();
    expect(lastHtml).toContain("data-never-log-error");
    expect(props).not.toBeNull();
    expect(captured.panel).not.toBeNull();
    expect(err.mock.calls.map((c) => String(c[0])).some((l) => l.startsWith("branding: account a1 never-record list read failed:"))).toBe(true);
    err.mockRestore();
  });
});

describe("branding page — the Never record card's language (review fix round 1, M1 and M2)", () => {
  const OWNER = { userId: "user_1", isAgency: false, role: "owner", canManage: true };

  it("a failed account-language read still renders the page and the list, logs the account id and the error's diagnosis only, and falls back to the reader's default (English) (mutation: delete the error branch → the log assertion FAILS)", async () => {
    accessFixture.access = OWNER;
    dbFixture.accountLanguage = "es";
    dbFixture.languageError = { code: "XX000", message: "internal error" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await render();
    expect(captured.panel).not.toBeNull();
    expect(lastHtml).toContain('data-never-log-entry="billing@supplier.com"');
    expect(lastHtml).toContain('lang="en"');
    const lines = err.mock.calls.map((c) => String(c[0]));
    const line = lines.find((l) => l.startsWith("branding: account a1 language read failed:"));
    expect(line, lines.join("\n")).toBeDefined();
    expect(line).toContain("XX000");
    expect(lines.join("\n")).not.toContain("billing@supplier.com");
    err.mockRestore();
  });

  it("the QA ?locale= override drives the list, as on the record page (mutation: drop { locale: localeParam } → FAILS)", async () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      accessFixture.access = OWNER;
      await render({ locale: "es" });
      expect(lastHtml).toContain('lang="es"');
      const { renderedText } = await import("@/lib/rendered-text");
      expect(renderedText(lastHtml)).toContain("No registrar nunca");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
