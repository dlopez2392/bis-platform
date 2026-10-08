import { describe, it, expect, vi, beforeEach } from "vitest";

// `vi.hoisted` because `vi.mock` factories are hoisted above ALL other
// module-level code, including these two `const`s — a bare
// `const getVoiceProfileAnyStatusByPublicIdMock = vi.fn()` below the mock
// (textually above it, but evaluated after the hoisted factory runs) throws
// "Cannot access '...' before initialization" the moment the factory
// assigns it as a property value directly, same as `actions.test.ts`'s
// `emailProviderThrowsRef` needs this for.
//
// F-102 review round, fix 2: `isConciergeLive` (and `brandDisplayName`) are
// pulled through `vi.importActual` now, NOT hand-rewritten in the mock
// factory. The previous version of this file rewrote `isConciergeLive`
// inline as `(p) => p.concierge_enabled === true && p.concierge_form_id !=
// null` while its own comment claimed it was "real logic, not mocked" — a
// copy that could drift from the real predicate silently, and exactly the
// shape a reviewer flagged.
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

import ConciergePage, { generateMetadata } from "./page";

const PROFILE = {
  id: "p1", account_id: "a1", persona_name: "Sofía",
  greeting_en: "Hi! How can I help?", greeting_es: "¡Hola!",
  facts: "f", services: "s", languages: "both", booking_enabled: false,
  after_hours: "message_only", enabled: true, textback_enabled: false,
  textback_body: "", public_id: "abc123", concierge_enabled: true,
  concierge_form_id: "f1", forward_calls: false,
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

// F-102 review round, fix 2: nothing had ever called the PAGE COMPONENT
// itself with an off/no-form-id/live profile and watched it 404 or render —
// only `generateMetadata` was under test. Mutating `isConciergeLive` to
// drop its `concierge_form_id != null` half, or rewriting `page.tsx`'s own
// check to `if (!profile) notFound()`, left every prior test in this file
// green.
describe("ConciergePage (F-102 review round, fix 2)", () => {
  it("404s when the concierge is switched off", async () => {
    getVoiceProfileAnyStatusByPublicIdMock.mockResolvedValue({ ...PROFILE, concierge_enabled: false });
    await expect(
      ConciergePage({ params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams }),
    ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  // Reachable in production: migration 0042's `concierge_form_id` is
  // `references forms(id) on delete set null`, so deleting a widget's
  // destination form leaves `concierge_enabled` true with no form id.
  it("404s when concierge_enabled is true but concierge_form_id is null (the deleted-destination-form case)", async () => {
    getVoiceProfileAnyStatusByPublicIdMock.mockResolvedValue({ ...PROFILE, concierge_form_id: null });
    await expect(
      ConciergePage({ params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams }),
    ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("404s for an unknown public id", async () => {
    getVoiceProfileAnyStatusByPublicIdMock.mockResolvedValue(null);
    await expect(
      ConciergePage({ params: Promise.resolve({ publicId: "nope" }), searchParams: noSearchParams }),
    ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("renders instead of calling notFound() when the concierge is live", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-key");
    getVoiceProfileAnyStatusByPublicIdMock.mockResolvedValue(PROFILE);
    getBrandingMock.mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
    const el = await ConciergePage({
      params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams,
    });
    expect(el.type).toBe("main");
    expect(el.props.className).toBe("bis-concierge");
  });
});

// F-102 review round, second pass (item 2, backfilled): removing
// `lang={locale}` from this element left every test in this file green —
// nothing asserted it, the same gap `/f`'s and `/b`'s own `<main lang>`
// suites were backfilled for. `<html lang>` (`app/c/[publicId]/layout.tsx`)
// carries no per-document default of its own to read here, so this element
// is the one place a `?locale=` override reaches the first server-rendered
// HTML, same reasoning as the other two public routes.
describe("ConciergePage <main lang>", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-key");
    getBrandingMock.mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
  });

  it("carries lang on <main>, matching the profile's own language default", async () => {
    getVoiceProfileAnyStatusByPublicIdMock.mockResolvedValue({ ...PROFILE, languages: "es" });
    const el = await ConciergePage({
      params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams,
    });
    // MUTATION: drop `lang={locale}` from <main> in page.tsx -- this FAILS
    // (`el.props.lang` is `undefined`).
    expect(el.props.lang).toBe("es");
  });

  it("carries lang on <main>, honoring a ?locale= override the profile's own default disagrees with", async () => {
    getVoiceProfileAnyStatusByPublicIdMock.mockResolvedValue({ ...PROFILE, languages: "en" });
    const el = await ConciergePage({
      params: Promise.resolve({ publicId: "abc123" }),
      searchParams: Promise.resolve({ locale: "es" }),
    });
    expect(el.props.lang).toBe("es");
  });
});

// F-102 review round, fix 1 (widened) — see
// `app/f/[publicId]/page.test.ts`'s identical test.
describe("generateMetadata never throws, even when the underlying read fails", () => {
  it("falls back to {robots} rather than rejecting", async () => {
    getVoiceProfileAnyStatusByPublicIdMock.mockRejectedValue(new Error("Invalid API key"));
    // MUTATION: call the page's OWN `loadProfile` here instead of
    // `loadProfileSafe` -- this FAILS (the promise rejects).
    await expect(
      generateMetadata({ params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams }),
    ).resolves.toEqual({ robots: { index: false, follow: false } });
  });
});
