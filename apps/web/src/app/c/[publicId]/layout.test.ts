import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/font/google", () => ({
  Geist: (o: unknown) => o, Inter: (o: unknown) => o, Source_Serif_4: (o: unknown) => o,
}));

// F-102 review round, fix 2 (the layout-wiring half) — same reasoning as
// `app/f/[publicId]/layout.test.ts`'s identical file.
const { getVoiceProfileAnyStatusByPublicIdMock, getBrandingMock } = vi.hoisted(() => ({
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
};

beforeEach(() => {
  getVoiceProfileAnyStatusByPublicIdMock.mockReset();
  getBrandingMock.mockReset();
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
