import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CallDetailRow, KnowledgeSnapshotRow, VoiceProfileRow } from "@bis/db";
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
  // S-47c follow-up (spec 5.4, C13): read only when ?call= is present, with the ROUTE's own accountId —
  // the same read the call page itself uses (CallDetailRow carries trade_module and knowledge_version).
  getCall: vi.fn<(...a: unknown[]) => Promise<CallDetailRow | null>>(async () => null),
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
  getCall: (...a: unknown[]) => dbMocks.getCall(...a),
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

/** The call `?call=call1` names: stamped with THIS snapshot's own version (3) and the insurance module
 *  (spec 5.4, C13). Other fields are irrelevant to this page and filled only so the type checks. */
const CALL: CallDetailRow = {
  id: "call1", started_at: "2026-10-20T15:00:00.000Z", ended_at: null, duration_secs: 60,
  outcome: "lead", language: "en", caller_e164: null, contact_id: null, conversation_id: null, contact: null,
  turn_count: 2, transcript: [], summary: "", booking_id: null,
  trade_module: "insurance_pc", trade_module_version: 1, knowledge_version: 3, business_status: null,
};

function render(version: string, searchParams: { locale?: string; call?: string } = {}) {
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
  dbMocks.getCall.mockReset().mockResolvedValue(CALL);
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

/** A UUID-shaped id (`isUuid`'s pattern): `?call=` is only ever worth a read when it looks like one. */
const CALL_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CALL_ID = "22222222-2222-4222-8222-222222222222";

/**
 * S-47c follow-up (spec 5.4, C13): on a call stamped under the insurance trade module, Sofía was given
 * only the service names and descriptions — never a price sentence — so this page must not overstate
 * what she knew there. The snapshot payload never records the module (it is the SAME either way, per
 * spec 5.4); it is this call's own `trade_module`/`knowledge_version` that gates the view, read with
 * THIS route's own accountId, on the REQUEST client (`REQUEST`, design review: the same client the
 * call page itself reads `getCall` through, never this page's own `serviceDb()`).
 */
describe("VoiceKnowledgePage — the ?call= parameter (insurance gating, S-47c follow-up)", () => {
  it("an insurance call hides every price sentence and any \"$\", and shows the insurance note (mutation: never hide the sentences → FAILS)", async () => {
    const html = await render("3", { call: CALL_ID });
    const text = renderedText(html);
    expect(html).not.toContain("The price for Catering is $35 per guest.");
    expect(html).not.toContain("El precio de Banquete es $35 por invitado.");
    expect(html).not.toContain("$");
    expect(text).toContain("On this call the insurance rules applied, so Sofía was given the service names and descriptions, never a price.");
    // Names and descriptions still show — only the sentences and the amount are gone.
    expect(html).toContain("Catering");
    expect(html).toContain("Hot food served at your event.");
  });

  it("an events call still shows both sentences, and no insurance note (mutation: gate on any module, not just insurance_pc → FAILS)", async () => {
    dbMocks.getCall.mockResolvedValue({ ...CALL, trade_module: "events" });
    const html = await render("3", { call: CALL_ID });
    const text = renderedText(html);
    expect(html).toContain("The price for Catering is $35 per guest.");
    expect(text).not.toContain("the insurance rules applied");
  });

  it("without ?call= the sentences appear and getCall is never read (today's behaviour, unchanged)", async () => {
    const html = await render("3");
    expect(html).toContain("The price for Catering is $35 per guest.");
    expect(dbMocks.getCall).not.toHaveBeenCalled();
  });

  it("getCall is read on the REQUEST client, with THIS route's own accountId (design review; mutation: read it with serviceDb() or a different id → FAILS)", async () => {
    await render("3", { call: CALL_ID });
    expect(dbMocks.getCall).toHaveBeenCalledWith(REQUEST, "acct1", CALL_ID);
    expect(dbMocks.getCall).not.toHaveBeenCalledWith(SERVICE, expect.anything(), expect.anything());
  });

  it("a call of another account comes back null (getCall's own account filter) and is ignored: sentences still show (mutation: trust the call without checking it exists → FAILS)", async () => {
    dbMocks.getCall.mockResolvedValue(null);
    const html = await render("3", { call: OTHER_CALL_ID });
    expect(dbMocks.getCall).toHaveBeenCalledWith(REQUEST, "acct1", OTHER_CALL_ID);
    expect(html).toContain("The price for Catering is $35 per guest.");
  });

  it("a call stamped with a different version is ignored on THIS version (mutation: compare only trade_module, never the version → FAILS)", async () => {
    dbMocks.getCall.mockResolvedValue({ ...CALL, knowledge_version: 9 });
    const html = await render("3", { call: CALL_ID });
    expect(html).toContain("The price for Catering is $35 per guest.");
  });

  it("reads the insurance note in Spanish under ?locale=es (mutation: hardcode the English key → FAILS)", async () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      const html = await render("3", { call: CALL_ID, locale: "es" });
      expect(renderedText(html)).toContain(
        "En esta llamada se aplicaron las reglas de seguros, así que a Sofía solo se le dieron los nombres y las descripciones de los servicios, nunca un precio.",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // Design review (point 3): a malformed id, or a repeated ?call= (which Next hands the page as an
  // array, never a string), must not reach getCall at all — a real UUID the database then errors on
  // is this page's own ERROR state (below), but a param that could never have named a real call must
  // be ignored instead, the same as no `call` at all.
  it.each(["not-a-uuid", "", "11111111111141118111111111111111", "'; drop table calls;--"])(
    "a malformed ?call= (%j) is ignored: getCall is never read, and the sentences show (mutation: drop the isUuid guard → FAILS)",
    async (bad) => {
      const html = await render("3", { call: bad });
      expect(dbMocks.getCall).not.toHaveBeenCalled();
      expect(html).toContain("The price for Catering is $35 per guest.");
    },
  );

  it("a repeated ?call=a&call=b (an array, never a string) is ignored: getCall is never read (mutation: drop the isUuid guard → FAILS)", async () => {
    const html = await VoiceKnowledgePage({
      params: Promise.resolve({ accountId: "acct1", version: "3" }),
      // Next hands a repeated query param to the page as a string[], never a string — exactly the
      // shape isUuid (typeof v === "string" first) refuses.
      searchParams: Promise.resolve({ call: [CALL_ID, OTHER_CALL_ID] as unknown as string }),
    }).then(renderToStaticMarkup);
    expect(dbMocks.getCall).not.toHaveBeenCalled();
    expect(html).toContain("The price for Catering is $35 per guest.");
  });
});
