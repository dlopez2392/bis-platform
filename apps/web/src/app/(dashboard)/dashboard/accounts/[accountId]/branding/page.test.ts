import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
// getPersonPrefs reads Clerk; mutable so a Spanish-preference test can set it.
const prefsFixture = vi.hoisted(() => ({ language: null as "en" | "es" | null }));
vi.mock("@/lib/preferences/person-prefs", () => ({
  getPersonPrefs: async () => ({ language: prefsFixture.language, theme: null }),
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
  props: null as { alertPhone: string | null; smsNotReady?: boolean; locale?: string; pseudo?: boolean } | null,
  panel: null as {
    mailingAddress?: string | null; locale?: string; pseudo?: boolean;
    action?: (fd: FormData) => Promise<unknown>;
    removeLogoAction?: () => Promise<unknown>;
    restoreLogoAction?: (p: string) => Promise<unknown>;
  } | null,
}));
vi.mock("@/components/branding-panel", () => ({
  BrandingPanel: (props: NonNullable<typeof captured.panel>) => {
    captured.panel = props;
    return null;
  },
}));
vi.mock("@/components/alert-phone-card", () => ({
  AlertPhoneCard: (props: NonNullable<typeof captured.props>) => {
    captured.props = props;
    return null;
  },
}));

// "use server" — cannot be imported into a vitest render.
vi.mock("../never-log-actions", () => ({
  addNeverLogAction: async () => ({ ok: false, error: "failed" }),
  removeNeverLogAction: async () => ({ ok: false, error: "failed" }),
}));
// Echoes the args it was called with, so a test can see what the PAGE bound
// (S-10 T6: the locale the page resolved, alongside accountId), without
// asserting these actions' own Spanish text — that is each action's own
// test file's job.
const actionCalls = vi.hoisted(() => ({ setBranding: [] as unknown[][], removeLogo: [] as unknown[][], restoreLogo: [] as unknown[][] }));
vi.mock("./actions", () => ({
  setBrandingAction: async (...a: unknown[]) => { actionCalls.setBranding.push(a); return { ok: true }; },
  removeBrandLogoAction: async (...a: unknown[]) => { actionCalls.removeLogo.push(a); return { ok: true, path: "acct/logo.png" }; },
  restoreBrandLogoAction: async (...a: unknown[]) => { actionCalls.restoreLogo.push(a); return { ok: true }; },
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
  prefsFixture.language = null;
  actionCalls.setBranding = [];
  actionCalls.removeLogo = [];
  actionCalls.restoreLogo = [];
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

  it("staff sees no list and the list itself is never read for them (mutation: drop the canManage gate → FAILS)", async () => {
    accessFixture.access = { userId: "user_1", isAgency: false, role: "staff", canManage: false };
    await render();
    expect(lastHtml).not.toContain("data-never-log");
    expect(dbFixture.neverLogReads).toEqual([]);
    // S-10 T6: the account-language read moved OUT of the canManage gate —
    // it now also drives the page's own title, BrandingPanel and
    // AlertPhoneCard for Staff, not just the Owner-only Never record list —
    // so staff DOES trigger exactly this one read now, same shape as every
    // other role (mutation: gate it behind canManage again → FAILS).
    expect(dbFixture.languageReads).toEqual([["accounts", "language", "id", "a1"]]);
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

// S-10 T6: the page's own title, and what it hands AlertPhoneCard and
// BrandingPanel, stayed English regardless of the reader's own stored
// choice — only the Owner-only Never record list read a locale at all.
describe("branding page — the whole page's own locale (S-10 T6)", () => {
  it("resolves person, then account, then English, for BOTH an Owner and Staff (mutation: gate the resolution behind canManage → FAILS)", async () => {
    for (const role of ["owner", "staff"] as const) {
      accessFixture.access = { userId: "user_1", isAgency: false, role, canManage: role === "owner" };
      dbFixture.accountLanguage = "es";
      prefsFixture.language = null;
      await render();
      expect(captured.props?.locale, role).toBe("es");
      expect(captured.panel?.locale, role).toBe("es");
    }
  });

  it("the person's own choice wins over the account's (mutation: swap the precedence → FAILS)", async () => {
    accessFixture.access = { userId: "user_1", isAgency: false, role: "staff", canManage: false };
    dbFixture.accountLanguage = "es";
    prefsFixture.language = "en";
    await render();
    expect(captured.props?.locale).toBe("en");
  });

  it("the page's own title reads in Spanish (mutation: hard-code m[key] in the page → FAILS)", async () => {
    const { m } = await import("@/lib/messages");
    accessFixture.access = { userId: "user_1", isAgency: false, role: "staff", canManage: false };
    dbFixture.accountLanguage = "es";
    await render();
    expect(lastHtml).toContain(m["branding.clientTitle.es"]);
    expect(lastHtml).not.toContain(m["branding.clientTitle"]);
  });

  it("binds setBrandingAction, removeBrandLogoAction and restoreBrandLogoAction with the resolved locale, alongside accountId (mutation: bind only accountId → FAILS)", async () => {
    accessFixture.access = { userId: "user_1", isAgency: false, role: "staff", canManage: false };
    dbFixture.accountLanguage = "es";
    await render();
    await captured.panel!.action!(new FormData());
    await captured.panel!.removeLogoAction!();
    await captured.panel!.restoreLogoAction!("a/logo-x.png");
    expect(actionCalls.setBranding[0]!.slice(0, 2)).toEqual(["a1", "es"]);
    expect(actionCalls.removeLogo[0]).toEqual(["a1", "es"]);
    expect(actionCalls.restoreLogo[0]).toEqual(["a1", "es", "a/logo-x.png"]);
  });
});

// A server component can hand a client component only a server action or its
// .bind(); an arrow wrapper renders fine through renderToStaticMarkup (every
// test above) and then fails at render in production. So the page's action
// props are pinned to .bind() at the source.
describe("branding/page.tsx passes BrandingPanel bound server actions, never arrow wrappers (mutation: wrap any one in an arrow → FAILS)", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");
  // Review fix round: the first guard only matched a PARENTHESIZED arrow
  // param ("(x) =>"), never a bracketless single-param arrow ("x =>") or a
  // `function` expression — both fail at render the same way an arrow
  // wrapper does, and NeverLogList's own `remove` prop is exactly the shape
  // ("id => removeNeverLogAction(accountId, id)") a careless edit could
  // reach for here. Widened to catch all three forms.
  const JSX_FUNCTION_PROP = /[A-Za-z]+=\{\s*(async\s*)?(\([^)]*\)\s*=>|\w+\s*=>|function\b)/;
  it("the widened guard catches a bracketless arrow and a function expression the original (parens-only) regex missed (mutation: narrow it back to parens-only → FAILS)", () => {
    const original = /[A-Za-z]+=\{\s*(async\s*)?\([^)]*\)\s*=>/;
    const bracketless = 'remove={id => removeNeverLogAction(accountId, id)}';
    const fn = 'remove={function (id) { return removeNeverLogAction(accountId, id); }}';
    expect(original.test(bracketless)).toBe(false);
    expect(original.test(fn)).toBe(false);
    expect(JSX_FUNCTION_PROP.test(bracketless)).toBe(true);
    expect(JSX_FUNCTION_PROP.test(fn)).toBe(true);
    // Still passes a real .bind() call and a plain prop — no false positive.
    expect(JSX_FUNCTION_PROP.test('action={setBrandingAction.bind(null, accountId, locale)}')).toBe(false);
    expect(JSX_FUNCTION_PROP.test('locale={locale}')).toBe(false);
  });
  it("no JSX prop on this server page is an arrow function or a function expression", () => {
    expect(src).not.toMatch(JSX_FUNCTION_PROP);
  });
  it("each of the three branding actions is bound with accountId and the reader's locale", () => {
    expect(src).toContain("action={setBrandingAction.bind(null, accountId, locale)}");
    expect(src).toContain("removeLogoAction={removeBrandLogoAction.bind(null, accountId, locale)}");
    expect(src).toContain("restoreLogoAction={restoreBrandLogoAction.bind(null, accountId, locale)}");
  });
});

// I2 (review fix round): the page passed `pseudo={pseudo}` to BrandingPanel,
// AlertPhoneCard and NeverLogList, but nothing proved any of the three
// survived a mutation back to `pseudo={false}` (or, for NeverLogList, to
// dropping the prop outright) — every PRE-EXISTING test above renders with
// no `?locale=pseudo` at all.
describe("branding page — pseudo wiring (I2, review fix round)", () => {
  const OWNER = { userId: "user_1", isAgency: false, role: "owner", canManage: true };

  it("passes pseudo=true to AlertPhoneCard and BrandingPanel, and renders NeverLogList's own title pseudo-wrapped, under BIS_I18N_QA + ?locale=pseudo (mutation: pseudo={false} on either card → FAILS; mutation: drop pseudo from NeverLogList → FAILS)", async () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      accessFixture.access = OWNER;
      const props = await render({ locale: "pseudo" });
      expect(props.pseudo).toBe(true);
      expect(captured.panel?.pseudo).toBe(true);
      const { pseudoLocale } = await import("@/lib/i18n/pseudo-locale");
      const { m } = await import("@/lib/messages");
      expect(lastHtml).toContain(pseudoLocale(m["neverLog.title"]));
      expect(lastHtml).not.toContain(`>${m["neverLog.title"]}<`);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("with no ?locale=pseudo, pseudo=false reaches both cards and NeverLogList's title is plain (unaffected baseline)", async () => {
    accessFixture.access = OWNER;
    const props = await render();
    expect(props.pseudo).toBe(false);
    expect(captured.panel?.pseudo).toBe(false);
    const { m } = await import("@/lib/messages");
    expect(lastHtml).toContain(`>${m["neverLog.title"]}<`);
  });
});
