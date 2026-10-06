import { describe, it, expect, vi, beforeEach } from "vitest";

// `vi.hoisted` because `vi.mock` factories are hoisted above ALL other
// module-level code, including these two `const`s — a bare
// `const getVoiceProfileAnyStatusByPublicIdMock = vi.fn()` below the mock
// (textually above it, but evaluated after the hoisted factory runs) throws
// "Cannot access '...' before initialization" the moment the factory
// assigns it as a property value directly, same as `actions.test.ts`'s
// `emailProviderThrowsRef` needs this for.
//
// F-102: `page.tsx` now reads through `./data`'s `loadProfile`
// (`getVoiceProfileAnyStatusByPublicId`, ANY status) and applies
// `isConciergeLive` itself, rather than `getVoiceProfileByPublicId`'s own
// SQL filter doing that folding — see `./data.ts`'s and `./layout.tsx`'s
// comments for why (the layout needs the row for a switched-off profile
// too). `isConciergeLive` is real logic, not mocked, same reasoning
// `getFormByPublicId`'s sibling test in `apps/web` would give: it is a pure
// predicate the page and the layout must apply IDENTICALLY, so faking it
// here would hide a drift between the two.
const { getVoiceProfileAnyStatusByPublicIdMock, getBrandingMock } = vi.hoisted(() => ({
  getVoiceProfileAnyStatusByPublicIdMock: vi.fn(),
  getBrandingMock: vi.fn(),
}));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getVoiceProfileAnyStatusByPublicId: getVoiceProfileAnyStatusByPublicIdMock,
  isConciergeLive: (p: { concierge_enabled: boolean; concierge_form_id: string | null }) =>
    p.concierge_enabled === true && p.concierge_form_id != null,
  getBranding: getBrandingMock,
  brandLogoUrl: () => null,
  brandDisplayName: (b: { brandName: string | null }) => b.brandName?.trim() || "",
}));

import { generateMetadata } from "./page";

const PROFILE = {
  id: "p1", account_id: "a1", persona_name: "Sofía",
  greeting_en: "Hi! How can I help?", greeting_es: "¡Hola!",
  facts: "f", services: "s", languages: "both", booking_enabled: false,
  after_hours: "message_only", enabled: true, textback_enabled: false,
  textback_body: "", public_id: "abc123", concierge_enabled: true,
  concierge_form_id: "f1",
};

const noSearchParams = Promise.resolve({});

beforeEach(() => {
  getVoiceProfileAnyStatusByPublicIdMock.mockReset();
  getBrandingMock.mockReset();
});

describe("/c/[publicId] metadata", () => {
  // robots is the one thing that must not depend on a database read: an
  // indexed chat page would surface a client's widget, and its query string,
  // in search results for someone who never visited their site.
  it("is noindex even when the branding read throws", async () => {
    getVoiceProfileAnyStatusByPublicIdMock.mockResolvedValue(PROFILE);
    getBrandingMock.mockRejectedValue(new Error("db down"));
    const meta = await generateMetadata({
      params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams,
    });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("is noindex for an unknown public id", async () => {
    getVoiceProfileAnyStatusByPublicIdMock.mockResolvedValue(null);
    const meta = await generateMetadata({
      params: Promise.resolve({ publicId: "nope" }), searchParams: noSearchParams,
    });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  // F-102 (defect :845's locale half, extended to the title): the chat's
  // own tab title now carries the business's name, not a bare "Chat".
  it("sets the business name in the tab title when the concierge is live", async () => {
    getVoiceProfileAnyStatusByPublicIdMock.mockResolvedValue(PROFILE);
    getBrandingMock.mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
    const meta = await generateMetadata({
      params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams,
    });
    expect(meta.title).toBe("Acme Plumbing · Chat");
  });

  // MUTATION: drop the `isConciergeLive` check in `generateMetadata` (treat
  // any found profile as live) -- this FAILS, because a switched-off
  // profile's branding would leak into the tab title.
  it("sets no title (falls through to the layout's fallback) when the concierge is off", async () => {
    getVoiceProfileAnyStatusByPublicIdMock.mockResolvedValue({ ...PROFILE, concierge_enabled: false });
    const meta = await generateMetadata({
      params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams,
    });
    expect(meta.title).toBeUndefined();
  });
});
