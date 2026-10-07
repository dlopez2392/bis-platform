import { describe, it, expect, vi, beforeEach } from "vitest";

// F-102 review round, fix 2: a reviewer found that mutating `isFormLive` to
// always return true, or collapsing `page.tsx`'s own check to
// `if (!form) notFound()`, leaves every EXISTING test green — nothing had
// ever actually called the page component with a draft or an archived form
// and watched it 404. `isFormLive` and `brandDisplayName` are pulled through
// `vi.importActual` rather than hand-rewritten in the mock factory (the
// mistake `c/[publicId]/page.test.ts` made before this same review round):
// a mock that re-implements real logic can drift from it silently, and a
// test built on that mock would not notice.
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

import PublicFormPage, { generateMetadata } from "./page";

const FIELDS = [{ key: "name", kind: "core.first_name" as const, label: "Name", required: false }];

function form(status: "draft" | "published" | "archived", localeDefault: "en" | "es" = "en") {
  return {
    id: "f1", account_id: "a1", public_id: "abc123", name: "N", status,
    fields: FIELDS, theme: {}, success_mode: "message" as const, success_message: null,
    redirect_url: null, notify_emails: [], locale_default: localeDefault,
    created_at: "", updated_at: "",
  };
}

const noSearchParams = Promise.resolve({});

beforeEach(() => {
  getFormByPublicIdMock.mockReset();
  getBrandingMock.mockReset();
});

describe("PublicFormPage (F-102 review round, fix 2)", () => {
  it.each(["draft", "archived"] as const)(
    "a %s form 404s — notFound() throws NEXT_HTTP_ERROR_FALLBACK;404",
    async (status) => {
      getFormByPublicIdMock.mockResolvedValue(form(status));
      await expect(
        PublicFormPage({ params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams }),
      ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    },
  );

  it("an unknown public id 404s the same way", async () => {
    getFormByPublicIdMock.mockResolvedValue(null);
    await expect(
      PublicFormPage({ params: Promise.resolve({ publicId: "nope" }), searchParams: noSearchParams }),
    ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("a published form renders instead of calling notFound()", async () => {
    // `issueRenderToken` → `signRenderToken` needs a key to hash with; this
    // route never reaches a real provider, so an in-process placeholder is
    // fine — not an edit to any `.env*` file.
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-key");
    getFormByPublicIdMock.mockResolvedValue(form("published"));
    getBrandingMock.mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
    const el = await PublicFormPage({
      params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams,
    });
    expect(el.type).toBe("main");
    expect(el.props.className).toBe("bis-form-page");
  });

  // F-102 review round, second pass (item 2): removing `lang={locale}`
  // from this element left every test in this file (5) green — nothing
  // asserted it. `<html lang>` (`layout.tsx`) carries the FORM's default,
  // not a `?locale=` override, so this element is the one place the
  // override actually reaches the first server-rendered HTML.
  it("carries lang on <main>, matching the form's own locale_default", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-key");
    getFormByPublicIdMock.mockResolvedValue(form("published", "es"));
    getBrandingMock.mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
    const el = await PublicFormPage({
      params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams,
    });
    // MUTATION: drop `lang={locale}` from <main> in page.tsx -- this FAILS
    // (`el.props.lang` is `undefined`).
    expect(el.props.lang).toBe("es");
  });

  it("carries lang on <main>, honoring a ?locale= override the form's own default disagrees with", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-key");
    getFormByPublicIdMock.mockResolvedValue(form("published", "en"));
    getBrandingMock.mockResolvedValue({ brandName: "Acme Plumbing", brandLogoPath: null });
    const el = await PublicFormPage({
      params: Promise.resolve({ publicId: "abc123" }),
      searchParams: Promise.resolve({ locale: "es" }),
    });
    expect(el.props.lang).toBe("es");
  });
});

// F-102 review round, fix 1 (widened): a reviewer's build+curl check showed
// that fixing ONLY `layout.tsx`'s own read was not enough — this page's own
// `generateMetadata` is a SEPARATE function Next does not wrap in any
// `error.tsx` boundary, so its unguarded `loadForm` call escaped straight
// to Next's bare `__next_error__` page even after the layout was fixed.
describe("generateMetadata never throws, even when the underlying read fails", () => {
  it("falls back to {robots} rather than rejecting", async () => {
    getFormByPublicIdMock.mockRejectedValue(new Error("Invalid API key"));
    // MUTATION: call the page's OWN `loadForm` here instead of
    // `loadFormSafe` -- this FAILS (the promise rejects instead of
    // resolving to `{ robots: ... }`).
    await expect(
      generateMetadata({ params: Promise.resolve({ publicId: "abc123" }), searchParams: noSearchParams }),
    ).resolves.toEqual({ robots: { index: false, follow: false } });
  });
});
