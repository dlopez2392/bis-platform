import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/font/google", () => ({
  Geist: (o: unknown) => o, Inter: (o: unknown) => o, Source_Serif_4: (o: unknown) => o,
}));

// F-102 review round, fix 2 (the layout-wiring half) — same reasoning as
// `app/f/[publicId]/layout.test.ts`'s identical file.
const { getVoiceProfileAnyStatusByPublicIdMock, getBrandingMock, readBillingStandingMock } = vi.hoisted(() => ({
  // M7a PR-4 (plan G10, M12): standing-read.ts reads it only while BILLING_ENFORCE is "1".
  readBillingStandingMock: vi.fn(),
  getVoiceProfileAnyStatusByPublicIdMock: vi.fn(),
  getBrandingMock: vi.fn(),
}));
vi.mock("@bis/db", async () => {
  const actual = await vi.importActual<typeof import("@bis/db")>("@bis/db");
  return {
    ...actual,
    serviceDb: () => ({}),
    getVoiceProfileAnyStatusByPublicId: getVoiceProfileAnyStatusByPublicIdMock,
    getBranding: getBrandingMock,
    readBillingStanding: readBillingStandingMock,
    brandLogoUrl: () => null,
  };
});

import ConciergeSegmentLayout, { generateMetadata } from "./layout";

const SENTINEL = "__children__";
const PROFILE = {
  id: "p1", account_id: "a1", persona_name: "Sofía",
  greeting_en: "Hi!", greeting_es: "¡Hola!", facts: "f", services: "s",
  languages: "es" as const, booking_enabled: false, after_hours: "message_only" as const,
  enabled: true, textback_enabled: false, textback_body: "", forward_calls: false,
  public_id: "p1", concierge_enabled: false, concierge_form_id: null,
  concierge_form_published: false,
};

beforeEach(() => {
  getVoiceProfileAnyStatusByPublicIdMock.mockReset();
  getBrandingMock.mockReset();
  readBillingStandingMock.mockReset().mockResolvedValue(null);
});

describe("ConciergeSegmentLayout (F-102 review round, fix 2 — layout wiring)", () => {
  it("sets <html lang> from the profile's OWN languages, not a literal", async () => {
    getVoiceProfileAnyStatusByPublicIdMock.mockResolvedValue(PROFILE);
    getBrandingMock.mockResolvedValue({ brandName: null, brandLogoPath: null });
    const el = await ConciergeSegmentLayout({
      params: Promise.resolve({ publicId: "p1" }), children: SENTINEL,
    });
    // MUTATION: hard-code `lang="en"` on `<PublicHtml>` in layout.tsx --
    // this FAILS (expects "es", gets "en").
    expect(el.props.lang).toBe("es");
  });

  it("catches its own read failure: falls back to lang 'en' and renders NO brand, rather than throwing", async () => {
    getVoiceProfileAnyStatusByPublicIdMock.mockRejectedValue(new Error("db down"));
    const el = await ConciergeSegmentLayout({
      params: Promise.resolve({ publicId: "p1" }), children: SENTINEL,
    });
    expect(el.props.lang).toBe("en");
    const providerChildren = el.props.children.props.children;
    expect(providerChildren).toBe(SENTINEL);
  });

  it("generateMetadata also catches its own read failure and falls back to the brand-free title", async () => {
    getVoiceProfileAnyStatusByPublicIdMock.mockRejectedValue(new Error("db down"));
    const meta = await generateMetadata({ params: Promise.resolve({ publicId: "p1" }) });
    expect(meta.title).toBe("Chat");
    expect(meta.icons).toEqual({ icon: "/favicon.ico" });
  });

  // F-102 review round, fix 4 — see `app/f/[publicId]/layout.test.ts`'s
  // identical test.
  it("wraps the branded not-found page in the account's own theme (brand colour), not just logo/name", async () => {
    getVoiceProfileAnyStatusByPublicIdMock.mockResolvedValue(PROFILE);
    getBrandingMock.mockResolvedValue({
      brandName: "Acme Plumbing", brandLogoPath: null,
      brandColor: "#2563eb", brandNeutral: "cool", brandCorners: "round",
      brandType: "inter", brandMode: "light",
    });
    const el = await ConciergeSegmentLayout({
      params: Promise.resolve({ publicId: "p1" }), children: SENTINEL,
    });
    const wrapper = el.props.children.props.children;
    // MUTATION: compute the theme from UNBRANDED instead of `branding` --
    // this FAILS, since `--accent` would be absent from the wrapper's style.
    expect(wrapper.props["data-tenant-theme"]).toBe("");
    expect(wrapper.props.style).toHaveProperty("--background");
    expect(wrapper.props.style).toHaveProperty("--accent");
  });
});

// M7a PR-4 (plan G10, M12): the layout asks the SAME question the page does,
// so a paused account's chat 404s with the brand a switched-off one carries.
describe("ConciergeSegmentLayout while billing is enforced (BILLING_ENFORCE)", () => {
  const LIVE = { ...PROFILE, concierge_enabled: true, concierge_form_id: "f1", concierge_form_published: true };
  const PAUSED = {
    complimentary: false, pausedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    subscriptionStatus: "past_due", features: { voice_receptionist: true, web_concierge: true },
  };
  beforeEach(() => { vi.stubEnv("BILLING_ENFORCE", "1"); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("a paused chat's not-found page is branded like a switched-off one, and its tab title is the brand's (mutation: keep isConciergeLive alone in the layout → FAILS)", async () => {
    getVoiceProfileAnyStatusByPublicIdMock.mockResolvedValue(LIVE);
    getBrandingMock.mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
    readBillingStandingMock.mockResolvedValue(PAUSED);
    const el = await ConciergeSegmentLayout({ params: Promise.resolve({ publicId: "p1" }), children: SENTINEL });
    const wrapper = el.props.children.props.children;
    expect(wrapper).not.toBe(SENTINEL);
    expect(wrapper.type).toBe("div");
    const meta = await generateMetadata({ params: Promise.resolve({ publicId: "p1" }) });
    expect(meta.title).toContain("Acme Plumbing");
  });

  it("a paying live chat: no brand from the layout (the page brands itself), the brand-free fallback title", async () => {
    getVoiceProfileAnyStatusByPublicIdMock.mockResolvedValue(LIVE);
    getBrandingMock.mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
    readBillingStandingMock.mockResolvedValue({ ...PAUSED, pausedAt: null, subscriptionStatus: "active" });
    const el = await ConciergeSegmentLayout({ params: Promise.resolve({ publicId: "p1" }), children: SENTINEL });
    expect(el.props.children.props.children).toBe(SENTINEL);
    const meta = await generateMetadata({ params: Promise.resolve({ publicId: "p1" }) });
    expect(meta.title).not.toContain("Acme Plumbing");
  });
});
