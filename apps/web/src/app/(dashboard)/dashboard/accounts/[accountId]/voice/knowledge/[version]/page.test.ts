import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { KnowledgeSnapshotRow, VoiceProfileRow } from "@bis/db";
import { renderedText } from "@/lib/rendered-text";
import { buildKnowledgePayload } from "@/lib/voice/knowledge/payload";

// Same shape as voice/page.test.ts: requireAgencyOnlyAccountAccess is a plain mock a test can reject,
// not a switchable isAgency flag — the function itself redirects a non-agency caller (lib/auth.ts), so
// nothing in this page re-checks it.
const requireAgencyOnlyAccountAccessMock = vi.fn<(accountId: string) => Promise<{ userId: string }>>(
  async () => ({ userId: "user_1" }),
);
vi.mock("@/lib/auth", () => ({
  requireAgencyOnlyAccountAccess: (accountId: string) => requireAgencyOnlyAccountAccessMock(accountId),
}));

const prefsFixture = vi.hoisted(() => ({ language: null as "en" | "es" | null }));
vi.mock("@/lib/preferences/person-prefs", () => ({
  getPersonPrefs: async () => ({ language: prefsFixture.language }),
}));

/** One stable sentinel (identity, not shape) so a read against the wrong client would be visible. */
const SERVICE = vi.hoisted(() => ({ tag: "serviceDb" }));
const dbMocks = vi.hoisted(() => ({
  getKnowledgeSnapshot: vi.fn<(...a: unknown[]) => Promise<KnowledgeSnapshotRow | null>>(),
  getLatestKnowledgeVersion: vi.fn<(...a: unknown[]) => Promise<number>>(),
  getVoiceProfile: vi.fn<(...a: unknown[]) => Promise<VoiceProfileRow | null>>(),
  listPeopleNames: vi.fn<(...a: unknown[]) => Promise<Record<string, string>>>(async () => ({})),
}));
/** The request client (RLS): the one listPeopleNames must be called with (packages/db/src/record.ts: "No
 *  service-role read names anyone"). */
const REQUEST = vi.hoisted(() => ({ tag: "dbForRequest" }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));
vi.mock("@bis/db", () => ({
  serviceDb: () => SERVICE,
  getKnowledgeSnapshot: (...a: unknown[]) => dbMocks.getKnowledgeSnapshot(...a),
  getLatestKnowledgeVersion: (...a: unknown[]) => dbMocks.getLatestKnowledgeVersion(...a),
  getVoiceProfile: (...a: unknown[]) => dbMocks.getVoiceProfile(...a),
  listPeopleNames: (...a: unknown[]) => dbMocks.listPeopleNames(...a),
}));

const { default: VoiceKnowledgePage } = await import("./page");

const PROFILE: VoiceProfileRow = {
  id: "vp1", account_id: "acct1", persona_name: "Sofía",
  greeting_en: "", greeting_es: "", facts: "", services: "",
  languages: "both", booking_enabled: true, after_hours: "hours_then_message",
  enabled: true, textback_enabled: true, textback_body: "",
  textback_body_es: null, textback_body_es_basis: null,
  public_id: null, concierge_enabled: false, concierge_form_id: null, forward_calls: false, disclosure: "off",
  trade_module: null,
  business_hours: null,
};

/** Built by the real writer's own renderer (`buildKnowledgePayload`), never hand-shaped: a snapshot's
 *  payload is exactly what `save_voice_knowledge`/`ensure_knowledge_snapshot` would have stored. */
const PAYLOAD = buildKnowledgePayload({
  facts: "Licensed and insured.",
  servicesText: "",
  timezone: "America/Chicago",
  businessHours: {
    mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]], wed: [["09:00", "17:00"]],
    thu: [["09:00", "17:00"]], fri: [["09:00", "17:00"]],
  },
  services: [
    {
      name_en: "Catering", name_es: "Banquete",
      description_en: "Hot food served at your event.", description_es: "Comida caliente servida en su evento.",
      price_kind: "per_unit", amount_cents: 3500, amount_max_cents: null, unit_en: "guest", unit_es: "invitado",
    },
  ],
});

const SNAPSHOT: KnowledgeSnapshotRow = {
  id: "kn1", account_id: "acct1", version: 3, payload: PAYLOAD,
  created_at: "2026-10-20T15:30:00.000Z", created_by: "user_42",
};

function render(version: string, searchParams: { locale?: string } = {}) {
  return VoiceKnowledgePage({
    params: Promise.resolve({ accountId: "acct1", version }),
    searchParams: Promise.resolve(searchParams),
  }).then(renderToStaticMarkup);
}

beforeEach(() => {
  requireAgencyOnlyAccountAccessMock.mockReset().mockResolvedValue({ userId: "user_1" });
  prefsFixture.language = null;
  dbMocks.getKnowledgeSnapshot.mockReset().mockResolvedValue(SNAPSHOT);
  dbMocks.getLatestKnowledgeVersion.mockReset().mockResolvedValue(5);
  dbMocks.getVoiceProfile.mockReset().mockResolvedValue(PROFILE);
  dbMocks.listPeopleNames.mockReset().mockResolvedValue({ user_42: "Ana Reyes" });
});

describe("VoiceKnowledgePage — loaded", () => {
  it("renders the saved version, its person and both price sentences (mutation: drop the person lookup → FAILS)", async () => {
    const html = await render("3");
    expect(html).toContain("What Sofía knew");
    // The card is titled by its version, so it never repeats the page header (design review).
    expect(html).toMatch(/<h3[^>]*>Version 3<\/h3>/);
    expect(renderedText(html)).toContain("Saved");
    expect(renderedText(html)).toContain("Ana Reyes");
    expect(html).toContain("Licensed and insured.");
    expect(html).toContain("Nothing was written here.");
    expect(html).toContain("Monday: 9:00 AM to 5:00 PM");
    expect(html).toContain("Catering");
    expect(html).toContain("The price for Catering is $35 per guest.");
    expect(html).toContain("El precio de Banquete es $35 por invitado.");
  });

  it("reads 'recorded automatically' for a system snapshot, with no person name (mutation: drop the system check → FAILS)", async () => {
    dbMocks.getKnowledgeSnapshot.mockResolvedValue({ ...SNAPSHOT, created_by: "system" });
    const html = await render("3");
    expect(renderedText(html)).toContain("Recorded automatically");
    expect(renderedText(html)).not.toContain("Ana Reyes");
    expect(renderedText(html)).not.toContain("Saved");
    expect(dbMocks.listPeopleNames).not.toHaveBeenCalled();
  });

  it("an id this reader cannot name reads 'Someone on the team' (mutation: drop the fallback → FAILS)", async () => {
    dbMocks.listPeopleNames.mockResolvedValue({});
    const html = await render("3");
    expect(renderedText(html)).toContain("Someone on the team");
  });

  it("version 1 has no Older link (mutation: always render Older → FAILS)", async () => {
    dbMocks.getKnowledgeSnapshot.mockResolvedValue({ ...SNAPSHOT, version: 1 });
    dbMocks.getLatestKnowledgeVersion.mockResolvedValue(5);
    const html = await render("1");
    expect(html).not.toContain(">Older<");
    expect(html).toContain(">Newer<");
  });

  it("the latest version has no Newer link (mutation: always render Newer → FAILS)", async () => {
    dbMocks.getKnowledgeSnapshot.mockResolvedValue({ ...SNAPSHOT, version: 5 });
    dbMocks.getLatestKnowledgeVersion.mockResolvedValue(5);
    const html = await render("5");
    expect(html).toContain(">Older<");
    expect(html).not.toContain(">Newer<");
  });

  it("the Older/Newer hrefs step by one version (mutation: hardcode the neighbour → FAILS)", async () => {
    const html = await render("3");
    expect(html).toContain('href="/dashboard/accounts/acct1/voice/knowledge/2"');
    expect(html).toContain('href="/dashboard/accounts/acct1/voice/knowledge/4"');
  });

  it("reads in Spanish under ?locale=es (mutation: hardcode the English key → FAILS)", async () => {
    // The QA override (request-locale.ts) is gated on BOTH an explicit flag and "not a Vercel
    // deployment" — the exact stub the call page's own Spanish trade-rules test uses.
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      const html = await render("3", { locale: "es" });
      expect(html).toContain("Lo que Sofía sabía");
      expect(renderedText(html)).toContain("Guardada");
      expect(renderedText(html)).toContain("Anterior");
      expect(renderedText(html)).toContain("Más reciente");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("VoiceKnowledgePage — the fix round", () => {
  it("names the saver through the REQUEST client, never the service client (record.ts: no service-role read names anyone; mutation: pass serviceDb() -> FAILS)", async () => {
    await render("3");
    expect(dbMocks.listPeopleNames).toHaveBeenCalledWith(REQUEST, ["user_42"]);
    expect(dbMocks.listPeopleNames).not.toHaveBeenCalledWith(SERVICE, expect.anything());
  });

  it("shows what she was told about each service: the Spanish name and both descriptions, each marked with its language (mutation: drop the About lines -> FAILS)", async () => {
    const html = await render("3");
    const text = renderedText(html);
    expect(text).toContain("Name in Spanish");
    expect(html).toMatch(/<dd lang="es">Banquete<\/dd>/);
    expect(text).toContain("About it, in English");
    expect(html).toMatch(/<dd lang="en">Hot food served at your event\.<\/dd>/);
    expect(text).toContain("About it, in Spanish");
    expect(html).toMatch(/<dd lang="es">Comida caliente servida en su evento\.<\/dd>/);
  });

  it("each price sentence is marked with its language (mutation: drop lang on a dd -> FAILS)", async () => {
    const html = await render("3");
    expect(html).toMatch(/<dd lang="en">The price for Catering is \$35 per guest\.<\/dd>/);
    expect(html).toMatch(/<dd lang="es">El precio de Banquete es \$35 por invitado\.<\/dd>/);
  });

  it("the four sections are h4s under the card's h3, and the services section reads 'Services & prices' (mutation: h3 sections -> FAILS)", async () => {
    const html = await render("3");
    const h4s = [...html.matchAll(/<h4[^>]*>([^<]*)<\/h4>/g)].map((h) => h[1]);
    expect(h4s).toEqual(["Facts", "Services (free text)", "Business hours", "Services &amp; prices"]);
    expect((html.match(/<h3\b/g) ?? []).length).toBe(1);
  });

  it("Older, Newer and Back keep ?locale= (mutation: drop the query -> FAILS)", async () => {
    const html = await render("3", { locale: "es" });
    expect(html).toContain('href="/dashboard/accounts/acct1/voice/knowledge/2?locale=es"');
    expect(html).toContain('href="/dashboard/accounts/acct1/voice/knowledge/4?locale=es"');
    expect(html).toContain('href="/dashboard/accounts/acct1/voice?locale=es"');
  });

  it("without ?locale= the links carry no query", async () => {
    const html = await render("3");
    expect(html).toContain('href="/dashboard/accounts/acct1/voice/knowledge/2"');
    expect(html).toContain('href="/dashboard/accounts/acct1/voice"');
    expect(html).not.toContain("?locale=");
  });
});

describe("VoiceKnowledgePage — not found", () => {
  it("a version with no row is the not-found state, with the back link (mutation: render the loaded card anyway → FAILS)", async () => {
    dbMocks.getKnowledgeSnapshot.mockResolvedValue(null);
    const html = await render("9");
    expect(renderedText(html)).toContain("no version 9");
    expect(html).toContain('href="/dashboard/accounts/acct1/voice"');
    expect(html).not.toContain("Licensed and insured.");
  });

  it("a malformed version segment is the not-found state WITHOUT reading the database (mutation: drop the format check → FAILS)", async () => {
    const html = await render("0");
    expect(renderedText(html)).toContain("This version doesn't exist.");
    expect(dbMocks.getKnowledgeSnapshot).not.toHaveBeenCalled();
  });

  it("a non-numeric or overlong segment reads the generic sentence and never echoes what was typed (design review; mutation: echo the segment → FAILS)", async () => {
    for (const segment of ["abc", "9".repeat(40)]) {
      const html = await render(segment);
      expect(renderedText(html)).toContain("This version doesn't exist.");
      expect(renderedText(html)).not.toContain(segment);
    }
    expect(dbMocks.getKnowledgeSnapshot).not.toHaveBeenCalled();
  });
});

describe("VoiceKnowledgePage — error", () => {
  it("a throwing read is the error state, not an unhandled rejection (mutation: let it throw → FAILS)", async () => {
    dbMocks.getKnowledgeSnapshot.mockRejectedValue(new Error("boom"));
    const html = await render("3");
    expect(renderedText(html)).toContain("Couldn't load this version");
  });

  it("a payload parseKnowledgePayload refuses is the error state (mutation: render the raw payload anyway → FAILS)", async () => {
    dbMocks.getKnowledgeSnapshot.mockResolvedValue({ ...SNAPSHOT, payload: { not: "a knowledge payload" } });
    const html = await render("3");
    expect(renderedText(html)).toContain("Couldn't load this version");
  });
});

describe("VoiceKnowledgePage — the agency-only guard", () => {
  it("a client is redirected by the guard before any read runs (mutation: skip the guard → FAILS)", async () => {
    requireAgencyOnlyAccountAccessMock.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(render("3")).rejects.toThrow(/NEXT_REDIRECT/);
    expect(dbMocks.getKnowledgeSnapshot).not.toHaveBeenCalled();
  });
});

describe("VoiceKnowledgePage — every read is scoped to this route's own account", () => {
  it("getKnowledgeSnapshot, getLatestKnowledgeVersion and getVoiceProfile are called with THIS account (mutation: read the snapshot without the account → FAILS)", async () => {
    await render("3");
    expect(dbMocks.getKnowledgeSnapshot).toHaveBeenCalledWith(SERVICE, "acct1", 3);
    expect(dbMocks.getLatestKnowledgeVersion).toHaveBeenCalledWith(SERVICE, "acct1");
    expect(dbMocks.getVoiceProfile).toHaveBeenCalledWith(SERVICE, "acct1");
  });

  it("a second account's route reads that account, not a leftover first one (mutation: cache the first account's id → FAILS)", async () => {
    await render("3");
    dbMocks.getKnowledgeSnapshot.mockClear();
    dbMocks.getLatestKnowledgeVersion.mockClear();
    dbMocks.getVoiceProfile.mockClear();
    await VoiceKnowledgePage({
      params: Promise.resolve({ accountId: "acct2", version: "3" }),
      searchParams: Promise.resolve({}),
    }).then(renderToStaticMarkup);
    expect(dbMocks.getKnowledgeSnapshot).toHaveBeenCalledWith(SERVICE, "acct2", 3);
    expect(dbMocks.getKnowledgeSnapshot).not.toHaveBeenCalledWith(SERVICE, "acct1", 3);
    expect(dbMocks.getLatestKnowledgeVersion).toHaveBeenCalledWith(SERVICE, "acct2");
    expect(dbMocks.getVoiceProfile).toHaveBeenCalledWith(SERVICE, "acct2");
  });
});
