import { describe, it, expect, vi, beforeEach } from "vitest";

// `vi.hoisted` because `vi.mock` factories are hoisted above ALL other
// module-level code, including these two `const`s — a bare
// `const getVoiceProfileByPublicIdMock = vi.fn()` below the mock (textually
// above it, but evaluated after the hoisted factory runs) throws
// "Cannot access '...' before initialization" the moment the factory
// assigns it as a property value directly, same as `actions.test.ts`'s
// `emailProviderThrowsRef` needs this for.
const { getVoiceProfileByPublicIdMock, getBrandingMock } = vi.hoisted(() => ({
  getVoiceProfileByPublicIdMock: vi.fn(),
  getBrandingMock: vi.fn(),
}));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getVoiceProfileByPublicId: getVoiceProfileByPublicIdMock,
  getBranding: getBrandingMock,
  brandLogoUrl: () => null,
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

beforeEach(() => {
  getVoiceProfileByPublicIdMock.mockReset();
  getBrandingMock.mockReset();
});

describe("/c/[publicId] metadata", () => {
  // robots is the one thing that must not depend on a database read: an
  // indexed chat page would surface a client's widget, and its query string,
  // in search results for someone who never visited their site.
  it("is noindex even when the branding read throws", async () => {
    getVoiceProfileByPublicIdMock.mockResolvedValue(PROFILE);
    getBrandingMock.mockRejectedValue(new Error("db down"));
    const meta = await generateMetadata({ params: Promise.resolve({ publicId: "abc123" }) });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("is noindex for an unknown public id", async () => {
    getVoiceProfileByPublicIdMock.mockResolvedValue(null);
    const meta = await generateMetadata({ params: Promise.resolve({ publicId: "nope" }) });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});
