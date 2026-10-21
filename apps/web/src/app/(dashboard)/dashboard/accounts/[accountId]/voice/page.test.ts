import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { VoiceProfileRow } from "@bis/db";
import { defaultTextbackBody } from "@/lib/voice/textback-body";

/**
 * What is under test here is ONE thing: which company name this page hands
 * the text-back preview.
 *
 * The defect: the page read `accounts.name` — the agency's INTERNAL label
 * ("Rio Roofing — trial") — while the sender (lib/voice/finish-call.ts)
 * signs the actual text with the customer-facing brand name. The operator
 * approved one message and a different one went to a stranger's phone, with
 * the internal label's em dash silently doubling the segment count the
 * counter under the textarea exists to show.
 *
 * `VoiceSettings` is stubbed rather than rendered: the assertion is about the
 * value the server component resolves, and rendering the real form would drag
 * Radix, sonner and the segment counter into a test that has nothing to say
 * about any of them.
 */
vi.mock("@/lib/auth", () => ({
  requireAgencyOnlyAccountAccess: async () => ({ userId: "user_1", isAgency: true }),
}));

// The paste-able snippet's origin has to match whatever host the operator is
// actually on — the forms/calendar embed cards' own precedent.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "app.example.com", "x-forwarded-proto": "https" }),
}));

const dbFixture = vi.hoisted(() => ({ brandName: null as string | null }));
const serviceDbMock = vi.hoisted(() => ({
  getBranding: vi.fn(), getVoiceProfile: vi.fn(), getTransferPhone: vi.fn(), listForms: vi.fn(),
}));

// One stable client, so the results card can be shown to receive THIS client rather than one of its own.
const serviceClient = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@bis/db", () => ({
  serviceDb: () => (serviceClient.client ??= {
    from: (table: string) => {
      if (table === "phone_numbers") {
        return {
          select: () => ({
            eq: () => ({ order: async () => ({ data: [], error: null }) }),
          }),
        };
      }
      // There is no second read. `brandDisplayName` lost its `accounts.name`
      // parameter, so the preview name comes from `getBranding` alone — an
      // `accounts` query from this page would be the old defect growing back.
      throw new Error(`voice page must not read "${table}"`);
    },
  }),
  getVoiceProfile: (...a: unknown[]) => serviceDbMock.getVoiceProfile(...a),
  getBranding: (...a: unknown[]) => serviceDbMock.getBranding(...a),
  getTransferPhone: (...a: unknown[]) => serviceDbMock.getTransferPhone(...a),
  listForms: (...a: unknown[]) => serviceDbMock.listForms(...a),
  // S-47a: never invoked in this test — `VoiceSettings` is stubbed below and
  // never renders the `disclosureResults` prop it is handed — but the Global
  // Constraints bare-`@bis/db`-factory grep requires every factory this file
  // list names to carry the symbol `disclosure-results-card.tsx` imports.
  getDisclosureResults: async () => ({
    said: { counted: 0, booked: 0, abandoned: 0, askedPerson: 0 },
    didnt: { counted: 0, booked: 0, abandoned: 0, askedPerson: 0 },
    notCounted: 0,
  }),
}));

const prefsFixture = vi.hoisted(() => ({ language: null as "en" | "es" | null }));
vi.mock("@/lib/preferences/person-prefs", () => ({
  getPersonPrefs: async () => ({ language: prefsFixture.language }),
}));

// "use server" modules cannot be imported into a vitest render.
vi.mock("./actions", () => ({
  saveVoiceProfileAction: async () => ({ ok: true }),
  assignNumberAction: async () => ({ ok: true }),
  setNumberStatusAction: async () => ({ ok: true }),
  setTransferPhoneAction: async () => ({ ok: true }),
  enableConciergeAction: async () => ({ ok: true, publicId: "pub_x" }),
  disableConciergeAction: async () => ({ ok: true }),
  setForwardCallsAction: async () => ({ ok: true }),
}));

const captured = vi.hoisted(() => ({
  props: null as {
    accountId?: string; brandName?: string; transferPhone?: string | null;
    publishedForms?: { id: string; name: string }[]; origin?: string;
    disclosureCopy?: { locale: string; legend: string; options: { value: string }[] };
    disclosureResults?: unknown;
  } | null,
}));
vi.mock("./voice-settings", () => ({
  VoiceSettings: (props: { brandName: string }) => {
    captured.props = props;
    return null;
  },
}));

const { default: VoicePage } = await import("./page");

const PROFILE: VoiceProfileRow = {
  id: "vp1", account_id: "a1", persona_name: "Sofía",
  greeting_en: "", greeting_es: "", facts: "", services: "",
  languages: "both", booking_enabled: true, after_hours: "hours_then_message",
  enabled: true, textback_enabled: true, textback_body: "",
  textback_body_es: null, textback_body_es_basis: null,
  public_id: null, concierge_enabled: false, concierge_form_id: null, forward_calls: false, disclosure: "off",
};

async function render(searchParams: { from?: string; locale?: string } = {}) {
  captured.props = null;
  const el = await VoicePage({
    params: Promise.resolve({ accountId: "a1" }),
    searchParams: Promise.resolve(searchParams),
  });
  renderToStaticMarkup(el);
  return captured.props!;
}

beforeEach(() => {
  dbFixture.brandName = null;
  serviceDbMock.getTransferPhone.mockReset().mockResolvedValue(null);
  serviceDbMock.getVoiceProfile.mockReset().mockResolvedValue(PROFILE);
  serviceDbMock.getBranding.mockReset().mockImplementation(async () => ({
    brandName: dbFixture.brandName, brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
  }));
  serviceDbMock.listForms.mockReset().mockResolvedValue([]);
  prefsFixture.language = null;
});

/**
 * The website assistant's destination picker only ever offers a PUBLISHED
 * form — a draft has no `/f/<publicId>` a lead could land on. `listForms`
 * returns every form on the account regardless of status; this page is the
 * one that narrows it, the same way the setup wizard narrows its own reads
 * rather than trusting the caller.
 */
describe("voice settings page — the website assistant's inputs", () => {
  it("hands the card only published forms, mapped to id and name", async () => {
    serviceDbMock.listForms.mockResolvedValue([
      { id: "f1", public_id: "pub1", name: "Contact us", status: "published", created_at: "", submissionCount: 0 },
      { id: "f2", public_id: "pub2", name: "Draft form", status: "draft", created_at: "", submissionCount: 0 },
    ]);
    const props = await render();
    expect(props.publishedForms).toEqual([{ id: "f1", name: "Contact us" }]);
  });

  it("computes the pasteable origin from the request's own host", async () => {
    const props = await render();
    expect(props.origin).toBe("https://app.example.com");
  });

  it("passes the account id through, for the empty state's link to Forms", async () => {
    const props = await render();
    expect(props.accountId).toBe("a1");
  });
});

describe("voice settings page — text-back preview name", () => {
  it("previews the BRAND name, not the agency's internal accounts.name label", async () => {
    dbFixture.brandName = "Rio Roofing";
    const props = await render();
    expect(props.brandName).toBe("Rio Roofing");
    // The exact string the sender would build, so a divergence between the
    // two resolvers shows up here rather than on a customer's phone.
    expect(defaultTextbackBody(props.brandName!, "en")).toBe(defaultTextbackBody("Rio Roofing", "en"));
    expect(defaultTextbackBody(props.brandName!, "en")).not.toContain("trial");
  });

  it("hands the preview NOTHING, never the account name, when the company has set no brand name", async () => {
    // `brandName` is null from beforeEach and there is no label to fall back
    // to any more. defaultTextbackBody drops the identifying clause rather
    // than inventing a company name, which is the honest answer here.
    const props = await render();
    expect(props.brandName).toBe("");
  });

  it("a failing branding read degrades to a blank name, never a 500", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    serviceDbMock.getBranding.mockRejectedValue(new Error("db down"));
    const props = await render();
    errSpy.mockRestore();
    // Blank is the one input defaultTextbackBody handles by dropping the
    // identifying clause rather than inventing a placeholder noun.
    expect(props.brandName).toBe("");
  });
});

/**
 * The transfer number is the only thing that makes "I'll put you through"
 * reachable, so the settings screen has to show the operator the value that
 * is actually stored — not a blank box they would read as "off".
 */
describe("voice settings page — the transfer number", () => {
  it("hands the settings screen the number callers are put through to", async () => {
    serviceDbMock.getTransferPhone.mockResolvedValue("+19565550123");
    const props = await render();
    expect(props.transferPhone).toBe("+19565550123");
  });

  it("no transfer number configured is a state, not a failure", async () => {
    // Null is where every account starts, and the field being blank is what
    // tells the operator Sofía takes a message instead.
    const props = await render();
    expect(props.transferPhone).toBeNull();
  });

  it("a failing transfer-phone read errors rather than painting a blank field", async () => {
    // Deliberately NOT the branding read's degrade-to-blank treatment. The
    // brand name only feeds a preview; this value feeds a form field whose
    // blank state MEANS "off", and saving that blank clears the column. A
    // silently empty box here is one Save away from turning a working
    // transfer off without anyone deciding to.
    serviceDbMock.getTransferPhone.mockRejectedValue(new Error("db down"));
    await expect(render()).rejects.toThrow();
  });
});

describe("voice settings page — the AI disclosure setting and results card (S-47a)", () => {
  it("builds the three-way copy from DISCLOSURE_VALUES and hands the card a React node (mutation: build the options from a two-value list → FAILS)", async () => {
    const props = await render();
    expect(props.disclosureCopy?.locale).toBe("en");
    expect(props.disclosureCopy?.options.map((o) => o.value)).toEqual(["off", "trial", "on"]);
    expect(isValidElement(props.disclosureResults)).toBe(true);
  });
});

/** The results card element inside the Suspense node the page hands VoiceSettings. */
function cardProps(node: unknown): { db: unknown; accountId: string; setting: string; retryHref: string } {
  if (!isValidElement(node)) throw new Error("disclosureResults is not an element");
  const child = (node.props as { children: unknown }).children;
  if (!isValidElement(child)) throw new Error("no card inside the Suspense boundary");
  return child.props as { db: unknown; accountId: string; setting: string; retryHref: string };
}

describe("voice settings page — the results card's inputs (S-47a fix round)", () => {
  it("hands the card the page's OWN client, never a second one (mutation: card calls serviceDb() itself -> in-account-service-reads FAILS; drop the prop -> this FAILS)", async () => {
    const props = await render();
    expect(serviceClient.client).not.toBeNull();
    expect(cardProps(props.disclosureResults).db).toBe(serviceClient.client);
    expect(cardProps(props.disclosureResults).accountId).toBe("a1");
  });

  it("hands the card the STORED setting, and off when there is no profile yet (the column default) (mutation: hard-code trial -> FAILS)", async () => {
    serviceDbMock.getVoiceProfile.mockResolvedValue({ ...PROFILE, disclosure: "on" });
    expect(cardProps((await render()).disclosureResults).setting).toBe("on");
    serviceDbMock.getVoiceProfile.mockResolvedValue(null);
    expect(cardProps((await render()).disclosureResults).setting).toBe("off");
  });

  it("Retry keeps the page's own query (mutation: drop the query -> FAILS)", async () => {
    expect(cardProps((await render()).disclosureResults).retryHref).toBe("/dashboard/accounts/a1/voice");
    expect(cardProps((await render({ from: "setup", locale: "es" })).disclosureResults).retryHref)
      .toBe("/dashboard/accounts/a1/voice?from=setup&locale=es");
  });

  it("?locale=pseudo reaches the disclosure copy under the QA flag (mutation: makeTr(locale) without requestPseudoMode -> FAILS)", async () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      const props = await render({ locale: "pseudo" });
      expect(props.disclosureCopy?.legend.startsWith("[Téll cállérs Sófíá ís án ÁÍ")).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
