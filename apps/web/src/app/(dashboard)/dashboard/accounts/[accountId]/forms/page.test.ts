import { describe, it, expect, afterEach, vi } from "vitest";
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

function route() {
  return { params: Promise.resolve({ accountId: "acct1" }) };
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
