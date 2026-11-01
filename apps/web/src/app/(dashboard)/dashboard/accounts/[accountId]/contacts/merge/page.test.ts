import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

/**
 * F-006 part 1 (plan Task 10, Step 4, folded Task 13 F-118 reconcile): the compare screen. Same mocking
 * shape as contacts/[contactId]/page.test.ts: notFound/redirect are stand-in throws, noteOpened is a
 * plain spy, and the client screen is stubbed to capture what the page handed it (a "use server" module
 * cannot be imported into a vitest render, so merge-actions.ts is mocked whole).
 */

type Access = { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean };
const accessFixture = vi.hoisted(() => ({ access: { userId: "user_1", isAgency: false, role: "staff" as string | null, canManage: false } as Access }));
vi.mock("@/lib/auth", () => ({ requireNotTechnician: async () => accessFixture.access }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: null, theme: null }) }));

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
class RedirectError extends Error {
  constructor(public readonly destination: string) { super(`NEXT_REDIRECT;${destination}`); }
}
const redirectMock = vi.fn((url: string) => { throw new RedirectError(url); });
vi.mock("next/navigation", () => ({
  notFound: () => { throw NOT_FOUND; },
  redirect: (url: string) => redirectMock(url),
}));

const noteOpenedMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
vi.mock("@/lib/access-log/note", () => ({ noteOpened: (...a: unknown[]) => noteOpenedMock(...a) }));

// Fix round, finding #5: a named variable, read fresh each test — never the `{ language: null }`
// literal the page used to hand `requestLocale`, which could never read a Spanish account.
const accountFixture = vi.hoisted(() => ({ language: null as string | null }));
const REQUEST = {
  tag: "request-db",
  from: (table: string) => {
    if (table !== "accounts") throw new Error(`unexpected read of ${table}`);
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { language: accountFixture.language }, error: null }) }) }) };
  },
};
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));

const getContactMock = vi.fn();
const contactMergePreviewMock = vi.fn();
const listPeopleNamesMock = vi.fn(async (..._a: unknown[]) => ({}) as Record<string, string>);
const listCustomFieldsMock = vi.fn(async (..._a: unknown[]) => [] as { field_key: string; name: string }[]);
vi.mock("@bis/db", () => ({
  getContact: (...a: unknown[]) => getContactMock(...a),
  contactMergePreview: (...a: unknown[]) => contactMergePreviewMock(...a),
  listPeopleNames: (...a: unknown[]) => listPeopleNamesMock(...a),
  listCustomFields: (...a: unknown[]) => listCustomFieldsMock(...a),
  MERGE_COUNT_KEYS: ["messages", "calls", "bookings", "documents", "opportunities", "notes", "tasks", "form_submissions"],
}));

vi.mock("../merge-actions", () => ({
  mergeContactsAction: vi.fn(), undoMergeAction: vi.fn(), dismissPairAction: vi.fn(), undismissPairAction: vi.fn(),
}));

const screenProps: Record<string, unknown>[] = [];
vi.mock("./merge-screen", () => ({ MergeScreen: (p: Record<string, unknown>) => { screenProps.push(p); return null; } }));

const { default: MergePage } = await import("./page");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function contact(id: string, over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id, first_name: "Maria", last_name: id === A ? "Garcia" : "G.", created_at: "2026-01-01T00:00:00Z",
    holds_shared_number: false, merged_into: null, custom: {}, ...over,
  };
}

function ctx(a?: string, b?: string, keep?: string) {
  return { params: Promise.resolve({ accountId: "acct1" }), searchParams: Promise.resolve({ a, b, keep }) };
}

const PREVIEW_OK = {
  status: "ok" as const,
  counts: { messages: 1, calls: 0, bookings: 0, documents: 0, opportunities: 0, notes: 0, tasks: 0, form_submissions: 0 },
  fields: { keep: {}, other: {} },
  seen: { keep: "a".repeat(32), other: "b".repeat(32) },
};

beforeEach(() => {
  vi.clearAllMocks();
  accessFixture.access = { userId: "user_1", isAgency: false, role: "staff", canManage: false };
  accountFixture.language = null;
  getContactMock.mockImplementation(async (_db: unknown, _accountId: string, id: string) => contact(id));
  contactMergePreviewMock.mockResolvedValue(PREVIEW_OK);
  listPeopleNamesMock.mockResolvedValue({});
  listCustomFieldsMock.mockResolvedValue([]);
  screenProps.length = 0;
});

describe("the compare page: what it refuses, before any markup", () => {
  it("a non-uuid a or b 404s before any contact read", async () => {
    await expect(MergePage(ctx("nope", B))).rejects.toThrow(/NEXT_NOT_FOUND/);
    expect(getContactMock).not.toHaveBeenCalled();
  });

  it("the same id for a and b 404s before any contact read (fix round, minor 10; mutation: drop the a===b check -> FAILS)", async () => {
    await expect(MergePage(ctx(A, A))).rejects.toThrow(/NEXT_NOT_FOUND/);
    expect(getContactMock).not.toHaveBeenCalled();
  });

  it("a missing contact 404s, and never calls noteOpened", async () => {
    getContactMock.mockImplementation(async (_db: unknown, _accountId: string, id: string) => (id === A ? null : contact(id)));
    await expect(MergePage(ctx(A, B))).rejects.toThrow(/NEXT_NOT_FOUND/);
    expect(noteOpenedMock).not.toHaveBeenCalled();
  });

  it("a holding record 404s, and never calls noteOpened", async () => {
    getContactMock.mockImplementation(async (_db: unknown, _accountId: string, id: string) =>
      contact(id, id === A ? { holds_shared_number: true } : {}));
    await expect(MergePage(ctx(A, B))).rejects.toThrow(/NEXT_NOT_FOUND/);
    expect(noteOpenedMock).not.toHaveBeenCalled();
  });

  it("a tombstone redirects to the duplicates view, and never calls noteOpened (mutation: note before the tombstone check -> FAILS)", async () => {
    getContactMock.mockImplementation(async (_db: unknown, _accountId: string, id: string) =>
      contact(id, id === B ? { merged_into: A } : {}));
    await expect(MergePage(ctx(A, B))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith("/dashboard/accounts/acct1/contacts?view=duplicates");
    expect(noteOpenedMock).not.toHaveBeenCalled();
  });
});

describe("the compare page: it notes BOTH contacts it shows, once each (F-118 reconcile)", () => {
  it("notes the kept and the other contact's ids (mutation: drop one noteOpened -> FAILS)", async () => {
    await MergePage(ctx(A, B));
    expect(noteOpenedMock).toHaveBeenCalledTimes(2);
    const ids = noteOpenedMock.mock.calls.map((c) => (c[2] as { recordId: string }).recordId).sort();
    expect(ids).toEqual([A, B].sort());
    for (const c of noteOpenedMock.mock.calls) expect(c[2]).toMatchObject({ kind: "contact" });
  });

  it("notes the older record as kept by default, and the picked one when ?keep= names it", async () => {
    renderToStaticMarkup(await MergePage(ctx(A, B)));
    expect(screenProps.at(-1)!.keep).toMatchObject({ id: A });
    screenProps.length = 0;
    renderToStaticMarkup(await MergePage(ctx(A, B, B)));
    expect(screenProps.at(-1)!.keep).toMatchObject({ id: B });
  });
});

describe("the compare page: a failed or refused preview is the error state, not a thrown page", () => {
  it("a refusal status never reaches MergeScreen", async () => {
    contactMergePreviewMock.mockResolvedValue({ status: "holding" });
    await MergePage(ctx(A, B));
    expect(screenProps).toEqual([]);
  });
  it("a throw is the error state too, never an unhandled rejection", async () => {
    contactMergePreviewMock.mockRejectedValue(new Error("boom"));
    await expect(MergePage(ctx(A, B))).resolves.toBeDefined();
    expect(screenProps).toEqual([]);
  });

  it("the error state carries a title and a way BACK to the duplicates view, not only Retry (fix round, minor 10; mutation: drop the back link -> FAILS)", async () => {
    contactMergePreviewMock.mockResolvedValue({ status: "holding" });
    const html = renderToStaticMarkup(await MergePage(ctx(A, B)));
    const text = renderedText(html);
    expect(text).toContain("Merge two records");
    expect(text).toContain("Couldn't load these two records. Try again.");
    expect(html).toContain(`href="/dashboard/accounts/acct1/contacts?view=duplicates"`);
    expect(text).toContain("Possible duplicates");
  });
});

describe("the compare page: the account's own language, read like sibling pages do (fix round, finding #5)", () => {
  it("a client-role staff member on a Spanish account resolves Spanish (mutation: hand requestLocale {language: null} -> this stays 'en', FAILS)", async () => {
    accountFixture.language = "es";
    renderToStaticMarkup(await MergePage(ctx(A, B)));
    expect(screenProps.at(-1)!.locale).toBe("es");
  });

  it("with no account language set, English (control)", async () => {
    accountFixture.language = null;
    renderToStaticMarkup(await MergePage(ctx(A, B)));
    expect(screenProps.at(-1)!.locale).toBe("en");
  });

  it("the error state (a refused preview) also renders in the account's own language, not hard-coded English", async () => {
    accountFixture.language = "es";
    contactMergePreviewMock.mockResolvedValue({ status: "holding" });
    const html = renderToStaticMarkup(await MergePage(ctx(A, B)));
    expect(html).toContain("Intentar de nuevo"); // record.card.retry's Spanish twin
  });

  // S-10 leftovers (#317 follow-up): keep/other's names are built with contactDisplayName with no
  // locale, even though the page resolves one right above — a nameless side read English regardless.
  it("a nameless side's stand-in name is handed to MergeScreen in Spanish (mutation: call contactDisplayName with no locale -> FAILS)", async () => {
    accountFixture.language = "es";
    getContactMock.mockImplementation(async (_db: unknown, _accountId: string, id: string) =>
      contact(id, { first_name: null, last_name: null }));
    renderToStaticMarkup(await MergePage(ctx(A, B)));
    expect(screenProps.at(-1)!.keep).toMatchObject({ name: "(sin nombre)" });
    expect(screenProps.at(-1)!.other).toMatchObject({ name: "(sin nombre)" });
  });
});

describe("the compare page: assignee ids resolve to names before they reach MergeScreen (fix round, finding #4)", () => {
  it("reads listPeopleNames for every assigned_to id the preview's fields carry, and hands the map down as assigneeNames", async () => {
    contactMergePreviewMock.mockResolvedValue({
      ...PREVIEW_OK,
      fields: { keep: { assigned_to: "user_1" }, other: { assigned_to: "user_2" } },
    });
    listPeopleNamesMock.mockResolvedValue({ user_1: "Ana López", user_2: "Beto Ruiz" });
    renderToStaticMarkup(await MergePage(ctx(A, B)));
    expect(listPeopleNamesMock).toHaveBeenCalledWith(REQUEST, expect.arrayContaining(["user_1", "user_2"]));
    expect(screenProps.at(-1)!.assigneeNames).toEqual({ user_1: "Ana López", user_2: "Beto Ruiz" });
  });

  it("a failed names read costs only the names, never the whole page (mutation: let it throw -> FAILS)", async () => {
    contactMergePreviewMock.mockResolvedValue({
      ...PREVIEW_OK,
      fields: { keep: { assigned_to: "user_1" }, other: {} },
    });
    listPeopleNamesMock.mockRejectedValue(new Error("down"));
    await expect(MergePage(ctx(A, B)).then((el) => renderToStaticMarkup(el))).resolves.toBeDefined();
    expect(screenProps.at(-1)!.assigneeNames).toEqual({});
  });

  it("with no assigned_to on either side, no read at all (mutation: always read -> FAILS)", async () => {
    renderToStaticMarkup(await MergePage(ctx(A, B)));
    expect(listPeopleNamesMock).not.toHaveBeenCalled();
  });
});

describe("the compare page: custom field DEFINITIONS reach MergeScreen as customFieldNames (fix round, minor 10)", () => {
  it("reads listCustomFields only when a custom.<key> conflict or Also-keeps entry is on screen, and hands the field_key -> name map down", async () => {
    contactMergePreviewMock.mockResolvedValue({
      ...PREVIEW_OK,
      fields: { keep: { custom: { favoriteColor: "Red" } }, other: { custom: { favoriteColor: "Blue" } } },
    });
    listCustomFieldsMock.mockResolvedValue([{ field_key: "favoriteColor", name: "Favorite Color" }]);
    renderToStaticMarkup(await MergePage(ctx(A, B)));
    expect(listCustomFieldsMock).toHaveBeenCalledWith(REQUEST, "acct1", "contact");
    expect(screenProps.at(-1)!.customFieldNames).toEqual({ favoriteColor: "Favorite Color" });
  });

  it("with no custom field on screen, no read at all (mutation: always read -> FAILS)", async () => {
    renderToStaticMarkup(await MergePage(ctx(A, B)));
    expect(listCustomFieldsMock).not.toHaveBeenCalled();
  });

  it("a failed custom field names read costs only the labels, never the whole page (mutation: let it throw -> FAILS)", async () => {
    contactMergePreviewMock.mockResolvedValue({
      ...PREVIEW_OK,
      fields: { keep: { custom: { favoriteColor: "Red" } }, other: { custom: { favoriteColor: "Blue" } } },
    });
    listCustomFieldsMock.mockRejectedValue(new Error("down"));
    await expect(MergePage(ctx(A, B)).then((el) => renderToStaticMarkup(el))).resolves.toBeDefined();
    expect(screenProps.at(-1)!.customFieldNames).toEqual({});
  });
});

describe("the compare page: three mutations the opus review found survived 8/8 green (fix round, finding #7)", () => {
  it("M1 — the preview's own `seen` fingerprints reach MergeScreen UNCHANGED (mutation: replace seen with zeros -> FAILS)", async () => {
    const seen = { keep: "a1".repeat(16), other: "b2".repeat(16) };
    contactMergePreviewMock.mockResolvedValue({ ...PREVIEW_OK, seen });
    renderToStaticMarkup(await MergePage(ctx(A, B)));
    expect(screenProps.at(-1)!.seen).toEqual(seen);
    expect(screenProps.at(-1)!.seen).not.toEqual({ keep: "0".repeat(32), other: "0".repeat(32) });
  });

  it("M2 — conflicts are built from the PREVIEW's fields, never the getContact rows (mutation: build from rowA/rowB instead -> FAILS)", async () => {
    getContactMock.mockImplementation(async (_db: unknown, _accountId: string, id: string) =>
      contact(id, { email: id === A ? "rowA@getcontact.example" : "rowB@getcontact.example" }));
    contactMergePreviewMock.mockResolvedValue({
      ...PREVIEW_OK,
      fields: { keep: { email: "keep@preview.example" }, other: { email: "other@preview.example" } },
    });
    renderToStaticMarkup(await MergePage(ctx(A, B)));
    const conflicts = screenProps.at(-1)!.conflicts as { field: string; keepValue: unknown; otherValue: unknown }[];
    const emailConflict = conflicts.find((c) => c.field === "email");
    expect(emailConflict).toMatchObject({ keepValue: "keep@preview.example", otherValue: "other@preview.example" });
  });

  it("M3 — the OLDER record is kept by created_at, even when the older one has the LARGER id (mutation: reverse the date comparison, or run the id tiebreak first -> FAILS)", async () => {
    getContactMock.mockImplementation(async (_db: unknown, _accountId: string, id: string) =>
      contact(id, id === A ? { created_at: "2026-02-01T00:00:00Z" } : { created_at: "2026-01-01T00:00:00Z" }));
    // A ("1...") sorts before B ("2...") by id alone, but B is the OLDER record here.
    renderToStaticMarkup(await MergePage(ctx(A, B)));
    expect(screenProps.at(-1)!.keep).toMatchObject({ id: B });
  });
});
