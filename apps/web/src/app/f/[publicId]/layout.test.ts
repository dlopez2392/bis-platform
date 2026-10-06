import { describe, it, expect, vi, beforeEach } from "vitest";

// `next/font/google` is a webpack/Turbopack loader in disguise — same
// hand-mocking `components/public/public-html.test.ts` already needs, for
// the same reason: the real export throws outside a Next build, and this
// layout pulls it in transitively via `PublicHtml`.
vi.mock("next/font/google", () => ({
  Geist: (o: unknown) => o, Inter: (o: unknown) => o, Source_Serif_4: (o: unknown) => o,
}));

// F-102 review round, fix 2 (the layout-wiring half): nothing rendered
// `layout.tsx` itself before this — every existing test only exercised the
// PURE `formLangDefault` function, so hard-coding this layout's `lang` prop
// back to a literal "en" (the exact regression this file guards against)
// survived every test in the suite.
const { getFormByPublicIdMock, getBrandingMock } = vi.hoisted(() => ({
  getFormByPublicIdMock: vi.fn(),
  getBrandingMock: vi.fn(),
}));
vi.mock("@bis/db", async () => {
  const actual = await vi.importActual<typeof import("@bis/db")>("@bis/db");
  return {
    ...actual,
    serviceDb: () => ({}),
    getFormByPublicId: getFormByPublicIdMock,
    getBranding: getBrandingMock,
    brandLogoUrl: () => null,
  };
});

import PublicFormSegmentLayout, { generateMetadata } from "./layout";

const SENTINEL = "__children__";

beforeEach(() => {
  getFormByPublicIdMock.mockReset();
  getBrandingMock.mockReset();
});

describe("PublicFormSegmentLayout (F-102 review round, fix 2 — layout wiring)", () => {
  it("sets <html lang> from the form's OWN locale_default, not a literal", async () => {
    getFormByPublicIdMock.mockResolvedValue({
      id: "f1", account_id: "a1", public_id: "p1", name: "N", status: "draft",
      fields: [], theme: {}, success_mode: "message", success_message: null,
      redirect_url: null, notify_emails: [], locale_default: "es",
      created_at: "", updated_at: "",
    });
    getBrandingMock.mockResolvedValue({ brandName: null, brandLogoPath: null });
    const el = await PublicFormSegmentLayout({
      params: Promise.resolve({ publicId: "p1" }), children: SENTINEL,
    });
    // MUTATION: hard-code `lang="en"` on `<PublicHtml>` in layout.tsx --
    // this FAILS (expects "es", gets "en").
    expect(el.props.lang).toBe("es");
  });

  it("catches its own read failure: falls back to lang 'en' and renders NO brand, rather than throwing", async () => {
    getFormByPublicIdMock.mockRejectedValue(new Error("db down"));
    const el = await PublicFormSegmentLayout({
      params: Promise.resolve({ publicId: "p1" }), children: SENTINEL,
    });
    expect(el.props.lang).toBe("en");
    // Unwrap PublicHtml -> PublicLocaleProvider -> (branded div | children).
    // MUTATION: swallow the error but still attempt the branding read
    // (e.g. call `loadFormBranding` unconditionally) -- this FAILS, because
    // `getBrandingMock` would then need a resolved value this test never
    // gives it, and the branded `<div>` wrapper would appear where the bare
    // sentinel is expected.
    const providerChildren = el.props.children.props.children;
    expect(providerChildren).toBe(SENTINEL);
  });

  it("generateMetadata also catches its own read failure and falls back to the brand-free title", async () => {
    getFormByPublicIdMock.mockRejectedValue(new Error("db down"));
    const meta = await generateMetadata({ params: Promise.resolve({ publicId: "p1" }) });
    expect(meta.title).toBe("Form");
    expect(meta.icons).toEqual({ icon: "/favicon.ico" });
  });

  // F-102 review round, fix 4: a known-but-not-live not-found page carries
  // the account's own COLOUR, not just its logo and name — wrapped in the
  // SAME `publicFormTheme` the live page paints on `<main>`.
  it("wraps the branded not-found page in the account's own theme (brand colour), not just logo/name", async () => {
    getFormByPublicIdMock.mockResolvedValue({
      id: "f1", account_id: "a1", public_id: "p1", name: "N", status: "draft",
      fields: [], theme: {}, success_mode: "message", success_message: null,
      redirect_url: null, notify_emails: [], locale_default: "en",
      created_at: "", updated_at: "",
    });
    getBrandingMock.mockResolvedValue({
      brandName: "Acme Plumbing", brandLogoPath: null,
      brandColor: "#2563eb", brandNeutral: "cool", brandCorners: "round",
      brandType: "inter", brandMode: "light",
    });
    const el = await PublicFormSegmentLayout({
      params: Promise.resolve({ publicId: "p1" }), children: SENTINEL,
    });
    const wrapper = el.props.children.props.children;
    // MUTATION: pass `null` as the hostMode/theme arg's BRANDING instead of
    // `branding` (i.e. compute an unbranded theme even when branding is
    // known) -- this FAILS, since `--accent`/`--background` etc. would be
    // absent from the wrapper's style.
    expect(wrapper.props["data-tenant-theme"]).toBe("");
    expect(wrapper.props.style).toHaveProperty("--background");
    expect(wrapper.props.style).toHaveProperty("--accent");
  });
});
