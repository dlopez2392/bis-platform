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

// S-10 T5 part 2: the page now resolves its own reader locale (requestLocale + getPersonPrefs), same
// stub, same reason forms/page.test.ts, calls/page.test.ts and contacts/page.test.ts already use.
const prefsFixture = vi.hoisted(() => ({ language: null as "en" | "es" | null }));
vi.mock("@/lib/preferences/person-prefs", () => ({
  getPersonPrefs: async () => ({ language: prefsFixture.language, theme: null }),
}));

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

/** The account's timezone AND language — the page's one cosmetic/locale query. */
const accountRead = vi.fn(async (): Promise<{ data: unknown; error: unknown }> =>
  ({ data: { timezone: "America/Chicago", language: null }, error: null }));
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
// S-10 T5 part 2: real vi.fn() (not bare arrows) so a test can assert what the PAGE bound onto them —
// in particular, that `locale` reaches them, not just `accountId`/`formId`.
const saveFormActionMock = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
const republishFormActionMock = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
vi.mock("../actions", () => ({
  saveFormAction: (...a: unknown[]) => saveFormActionMock(...a),
  republishFormAction: (...a: unknown[]) => republishFormActionMock(...a),
}));

// The three client/presentational cards: recorded, not run — each has its own tests. S-10 T5 part 2
// upgrades these from `() => null` to prop-capturing spies, so this page's own locale-wiring (which
// prop gets `readerLocale` vs the form's own `locale`) is provable without a DOM renderer.
const formEditorProps = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
const embedSnippetProps = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
const submissionsTableProps = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
vi.mock("./form-editor", () => ({
  FormEditor: (props: Record<string, unknown>) => { formEditorProps.value = props; return null; },
}));
vi.mock("./embed-snippet", () => ({
  EmbedSnippet: (props: Record<string, unknown>) => { embedSnippetProps.value = props; return null; },
}));
vi.mock("./submissions-table", () => ({
  SubmissionsTable: (props: Record<string, unknown>) => { submissionsTableProps.value = props; return null; },
}));

// F-118 part 1 (plan Task 7): the ONE access-log write this page makes, after getForm proved the form.
const noteOpenedMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
vi.mock("@/lib/access-log/note", () => ({ noteOpened: (...a: unknown[]) => noteOpenedMock(...a) }));

const { default: FormEditorPage } = await import("./page");

const FORM = { id: "f1", account_id: "acct1", name: "Contact us", public_id: "p1", status: "published", locale_default: "en" };

async function render(): Promise<string> {
  const el = await FormEditorPage({
    params: Promise.resolve({ accountId: "acct1", formId: "f1" }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  authFixture.isAgency = true;
  prefsFixture.language = null;
  requireNotTechnicianMock.mockReset().mockImplementation(async () => (
    { userId: "u1", isAgency: authFixture.isAgency, role: null, canManage: true }));
  getFormMock.mockReset().mockResolvedValue(FORM);
  listSubmissionsMock.mockReset().mockResolvedValue([]);
  listCustomFieldsMock.mockReset().mockResolvedValue([]);
  findConciergeDestinationNameMock.mockReset().mockResolvedValue(null);
  accountRead.mockReset().mockResolvedValue({ data: { timezone: "America/Chicago", language: null }, error: null });
  noteOpenedMock.mockReset().mockResolvedValue(undefined);
  saveFormActionMock.mockReset().mockResolvedValue({ ok: true });
  republishFormActionMock.mockReset().mockResolvedValue({ ok: true });
  formEditorProps.value = null;
  embedSnippetProps.value = null;
  submissionsTableProps.value = null;
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

/**
 * S-10 T5 part 2: the page itself has no direct `m[...]` read (it renders no
 * copy of its own — only `PageHeader title={form.name}`, which is the
 * operator's own data, not catalogue copy), but it is the ONE place that
 * resolves the reader's locale and must hand it to every child as
 * `readerLocale` — the known trap this task names is that `EmbedSnippet`
 * ALSO takes a `locale` prop that means the FORM's own language
 * (`form.locale_default`), and the two must never be confused here.
 */
describe("FormEditorPage resolves and forwards the reader's locale (S-10 T5 part 2)", () => {
  it("resolves Spanish from the person's own prefs and passes it as readerLocale to all three cards, leaving EmbedSnippet's `locale` prop as the FORM's own (mutation: pass form.locale_default as readerLocale, or drop it, → FAILS)", async () => {
    prefsFixture.language = "es";
    await render();
    expect(formEditorProps.value?.readerLocale).toBe("es");
    expect(submissionsTableProps.value?.readerLocale).toBe("es");
    expect(embedSnippetProps.value?.readerLocale).toBe("es");
    // The form's OWN language is untouched by the reader's choice.
    expect(embedSnippetProps.value?.locale).toBe("en");
  });

  it("an English-reading operator editing a Spanish-language form gets readerLocale 'en' and the form's own locale 'es' at once (mutation: collapse the two into one value → FAILS)", async () => {
    getFormMock.mockResolvedValue({ ...FORM, locale_default: "es" });
    prefsFixture.language = "en";
    await render();
    expect(formEditorProps.value?.readerLocale).toBe("en");
    expect(embedSnippetProps.value?.locale).toBe("es");
    expect(embedSnippetProps.value?.readerLocale).toBe("en");
  });

  it("defaults to English with no stored preference and no account language (mutation: default to Spanish → FAILS)", async () => {
    await render();
    expect(formEditorProps.value?.readerLocale).toBe("en");
  });

  it("an agency operator's own choice wins over the account's language (owner decision 1; mutation: read account.language for an agency session → FAILS)", async () => {
    accountRead.mockResolvedValue({ data: { timezone: "America/Chicago", language: "es" }, error: null });
    authFixture.isAgency = true;
    requireNotTechnicianMock.mockResolvedValue({ userId: "u1", isAgency: true, role: null, canManage: true });
    prefsFixture.language = "en";
    await render();
    expect(formEditorProps.value?.readerLocale).toBe("en");
  });

  it("a client role with no own preference falls back to the account's language (mutation: ignore account.language for a client → FAILS)", async () => {
    accountRead.mockResolvedValue({ data: { timezone: "America/Chicago", language: "es" }, error: null });
    authFixture.isAgency = false;
    requireNotTechnicianMock.mockResolvedValue({ userId: "u1", isAgency: false, role: "owner", canManage: true });
    prefsFixture.language = null;
    await render();
    expect(formEditorProps.value?.readerLocale).toBe("es");
  });

  it("binds the resolved locale into saveFormAction ahead of formData, and into republishFormAction ahead of expectedPriorStatus (mutation: bind a different value, or drop it, → FAILS)", async () => {
    prefsFixture.language = "es";
    await render();
    const action = formEditorProps.value?.action as (fd: FormData) => Promise<unknown>;
    const fd = new FormData();
    await action(fd);
    expect(saveFormActionMock).toHaveBeenCalledWith("acct1", "es", fd);

    const republishAction = formEditorProps.value?.republishAction as (s: string) => Promise<unknown>;
    await republishAction("draft");
    expect(republishFormActionMock).toHaveBeenCalledWith("acct1", "f1", "es", "draft");
  });
});
