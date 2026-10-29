import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * F-118 part 1 (plan Task 7; spec 4.1): the forms editor page's own access-log write, after getForm has
 * proven the form — never before, never swallowed. The mock shape mirrors
 * calls/[callId]/page.test.ts:19-130, adapted to this page's own reads (getForm, listSubmissions,
 * listCustomFields, findConciergeDestinationName, the account's own timezone and the request headers
 * the embed snippet needs).
 */

/** Mutable, via `vi.hoisted` so the factory can close over it without a TDZ hazard (same idiom as the
 *  calls page test this file's mock shape is copied from). */
const authFixture = vi.hoisted(() => ({ isAgency: true }));
type Access = { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean };
const requireNotTechnicianMock = vi.fn<(accountId: string) => Promise<Access>>(async () => (
  { userId: "u1", isAgency: authFixture.isAgency, role: null, canManage: true }));
vi.mock("@/lib/auth", () => ({ requireNotTechnician: (accountId: string) => requireNotTechnicianMock(accountId) }));

const getFormMock = vi.fn();
const listSubmissionsMock = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
const listCustomFieldsMock = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
const findConciergeDestinationNameMock = vi.fn(async (..._a: unknown[]): Promise<string | null> => null);
vi.mock("@bis/db", () => ({
  getForm: (...a: unknown[]) => getFormMock(...a),
  listSubmissions: (...a: unknown[]) => listSubmissionsMock(...a),
  listCustomFields: (...a: unknown[]) => listCustomFieldsMock(...a),
  findConciergeDestinationName: (...a: unknown[]) => findConciergeDestinationNameMock(...a),
}));

/** The account's timezone read, the page's one cosmetic query. */
const accountRead = vi.fn(async (): Promise<{ data: unknown; error: unknown }> =>
  ({ data: { timezone: "America/Chicago" }, error: null }));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: (table: string) => {
      if (table !== "accounts") throw new Error(`unexpected read of ${table}`);
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => accountRead() };
      return chain;
    },
  }),
}));

const renderZoneMock = vi.fn(async (z: string | undefined) => (z
  ? { zone: z, guessed: false, label: z, source: "account" as const }
  : { zone: "UTC", guessed: true, label: "UTC", source: "fallback" as const }));
vi.mock("@/lib/zone", () => ({ renderZone: (z: string | undefined) => renderZoneMock(z) }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "app.example.com", "x-forwarded-proto": "https" }),
}));

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({ notFound: () => { throw NOT_FOUND; } }));

// "use server" modules cannot be imported into a vitest render; the editor only BINDS these.
vi.mock("../actions", () => ({ saveFormAction: async () => {}, republishFormAction: async () => {} }));
// The three client/presentational cards: recorded, not run — each has its own tests.
vi.mock("./form-editor", () => ({ FormEditor: () => null }));
vi.mock("./embed-snippet", () => ({ EmbedSnippet: () => null }));
vi.mock("./submissions-table", () => ({ SubmissionsTable: () => null }));

// F-118 part 1 (plan Task 7): the ONE access-log write this page makes, after getForm proved the form.
const noteOpenedMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
vi.mock("@/lib/access-log/note", () => ({ noteOpened: (...a: unknown[]) => noteOpenedMock(...a) }));

const { default: FormEditorPage } = await import("./page");

const FORM = { id: "f1", account_id: "acct1", name: "Contact us", public_id: "p1", status: "published", locale_default: "en" };

async function render(): Promise<string> {
  const el = await FormEditorPage({ params: Promise.resolve({ accountId: "acct1", formId: "f1" }) });
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  authFixture.isAgency = true;
  requireNotTechnicianMock.mockReset().mockImplementation(async () => (
    { userId: "u1", isAgency: authFixture.isAgency, role: null, canManage: true }));
  getFormMock.mockReset().mockResolvedValue(FORM);
  listSubmissionsMock.mockReset().mockResolvedValue([]);
  listCustomFieldsMock.mockReset().mockResolvedValue([]);
  findConciergeDestinationNameMock.mockReset().mockResolvedValue(null);
  accountRead.mockReset().mockResolvedValue({ data: { timezone: "America/Chicago" }, error: null });
  noteOpenedMock.mockReset().mockResolvedValue(undefined);
});

describe("the form editor page logs BIS's open (F-118 part 1)", () => {
  it("calls noteOpened with the access the guard returned, this account and the form's kind/id (mutation: pass a different kind or id -> FAILS)", async () => {
    await render();
    expect(noteOpenedMock).toHaveBeenCalledWith(
      { userId: "u1", isAgency: true, role: null, canManage: true }, "acct1", { kind: "form_answers", recordId: "f1" });
  });

  it("getForm -> null gives notFound and makes no call (mutation: log before getForm -> FAILS)", async () => {
    getFormMock.mockResolvedValue(null);
    await expect(render()).rejects.toBe(NOT_FOUND);
    expect(noteOpenedMock).not.toHaveBeenCalled();
  });

  it("a rejected noteOpened rejects the page (mutation: swallow it -> FAILS)", async () => {
    noteOpenedMock.mockRejectedValue(new Error("no live visit"));
    await expect(render()).rejects.toThrow("no live visit");
  });
});
