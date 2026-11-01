import { describe, it, expect, afterEach, vi } from "vitest";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import { m } from "@/lib/messages";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

/**
 * Every form row's own `created_at` rendered through `formatDateTime` — the
 * RUNTIME's zone (server or browser), never the account's — the same bug
 * D-010 fixed for the contacts list and the activity timeline. Same mocking
 * shape as contacts/page.test.ts's own: the page's own direct account-
 * timezone query, projected through `@/lib/zone`'s `renderZone`.
 */
vi.mock("./new-form-dialog", () => ({ NewFormDialog: () => null }));
vi.mock("./actions", () => ({ createFormAction: vi.fn() }));

const accountRead = vi.fn(async (): Promise<{ data: unknown; error: unknown }> =>
  ({ data: { timezone: "America/Chicago" }, error: null }));
// F-085 part 1: the page now calls requireNotTechnician first (spec §7.1).
vi.mock("@/lib/auth", () => ({ requireNotTechnician: async () => ({ userId: "user_1", isAgency: true, role: null, canManage: true }) }));
// S-10 T5: the page now resolves its own locale (requestLocale + getPersonPrefs), same stub,
// same reason contacts/page.test.ts and calls/page.test.ts already use.
const prefsFixture = vi.hoisted(() => ({ language: null as "en" | "es" | null }));
vi.mock("@/lib/preferences/person-prefs", () => ({
  getPersonPrefs: async () => ({ language: prefsFixture.language, theme: null }),
}));

vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: (table: string) => {
      if (table !== "accounts") throw new Error(`unexpected read of ${table}`);
      return { select: () => ({ eq: () => ({ maybeSingle: () => accountRead() }) }) };
    },
  }),
}));
const renderZoneMock = vi.fn(async (z: string | undefined) => (z
  ? { zone: z, guessed: false, label: z, source: "account" as const }
  : { zone: "UTC", guessed: true, label: "UTC", source: "fallback" as const }));
vi.mock("@/lib/zone", () => ({
  renderZone: (z: string | undefined) => renderZoneMock(z),
}));

const listFormsMock = vi.fn(async () => [
  { id: "f1", name: "Contact", status: "published", submissionCount: 2, created_at: "2026-10-08T05:00:00.000Z" },
]);
vi.mock("@bis/db", () => ({ listForms: () => listFormsMock() }));

const { default: FormsPage } = await import("./page");

function route(locale?: string) {
  return { params: Promise.resolve({ accountId: "acct1" }), searchParams: Promise.resolve({ locale }) };
}

describe("FormsPage's row timestamp renders in the ACCOUNT's zone, not the runtime's", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("a form's created_at follows the account's zone (Berlin), not the runtime's (Chicago)", async () => {
    vi.stubEnv("TZ", "America/Chicago");
    accountRead.mockResolvedValueOnce({ data: { timezone: "Europe/Berlin" }, error: null });
    const html = renderToStaticMarkup((await FormsPage(route())) as React.ReactElement);
    const text = renderedText(html);
    // 05:00 UTC is 7:00 AM in Berlin but 12:00 AM (midnight) in Chicago.
    expect(text).toContain("7:00 AM");
    expect(text).not.toContain("12:00 AM");
  });
});

// S-10 T5: the whole page used to be bare m[] reads, English regardless of the reader's own
// choice (`prefs.language`).
describe("FormsPage — Spanish (S-10 T5)", () => {
  afterEach(() => { prefsFixture.language = null; });

  it("renders the title and the status chip in Spanish for a Spanish-reading operator (mutation: hard-code English -> FAILS)", async () => {
    prefsFixture.language = "es";
    const html = renderToStaticMarkup((await FormsPage(route())) as React.ReactElement);
    const text = renderedText(html);
    expect(text).toContain("Formularios");
    expect(text).toContain("Publicado");
    expect(text).not.toContain("Published");
  });

  it("the QA pseudo-locale reaches the title, the empty state and the status chip (S-10 fix round M1; mutation: t(m, ...) -> FAILS)", async () => {
    vi.stubEnv("BIS_I18N_QA", "1"); vi.stubEnv("VERCEL", "");
    const text = renderedText(renderToStaticMarkup((await FormsPage(route("pseudo"))) as React.ReactElement));
    expect(text).toContain(pseudoLocale(m["forms.title"]));
    expect(text).toContain(pseudoLocale(m["forms.status.published"]));
    listFormsMock.mockResolvedValueOnce([]);
    const empty = renderedText(renderToStaticMarkup((await FormsPage(route("pseudo"))) as React.ReactElement));
    expect(empty).toContain(pseudoLocale(m["forms.empty.title"]));
    vi.unstubAllEnvs();
  });

  // S-10 fix round I3: the row's date was formatted without the page's
  // locale, so a Spanish list printed "Oct 8, 2026".
  it("prints each row's date in the reader's Spanish (mutation: drop locale from formatDateTimeInZone -> FAILS)", async () => {
    prefsFixture.language = "es";
    const text = renderedText(renderToStaticMarkup((await FormsPage(route())) as React.ReactElement));
    expect(text).toContain("8 oct 2026");
    expect(text).not.toContain("Oct 8, 2026");
  });

  // S-10 fix round I3: "{n} envíos" was a number glued to a lower-cased
  // column title — wrong at 1 in both languages ("1 envíos", "1 submissions").
  it("counts submissions with a real singular at 1 and plural at 2, in both languages (mutation: back to the glued column title -> FAILS)", async () => {
    const one = { id: "f1", name: "Contact", status: "published", submissionCount: 1, created_at: "2026-10-08T05:00:00.000Z" };
    const two = { ...one, submissionCount: 2 };
    listFormsMock.mockResolvedValueOnce([one]);
    expect(renderedText(renderToStaticMarkup((await FormsPage(route())) as React.ReactElement))).toContain("1 submission");
    listFormsMock.mockResolvedValueOnce([one]);
    expect(renderedText(renderToStaticMarkup((await FormsPage(route())) as React.ReactElement))).not.toContain("1 submissions");
    prefsFixture.language = "es";
    listFormsMock.mockResolvedValueOnce([one]);
    const esOne = renderedText(renderToStaticMarkup((await FormsPage(route())) as React.ReactElement));
    expect(esOne).toContain("1 envío");
    expect(esOne).not.toContain("1 envíos");
    listFormsMock.mockResolvedValueOnce([two]);
    expect(renderedText(renderToStaticMarkup((await FormsPage(route())) as React.ReactElement))).toContain("2 envíos");
  });
});
