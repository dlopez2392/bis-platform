import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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

const REQUEST = { tag: "request-db" };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));

const getContactMock = vi.fn();
const contactMergePreviewMock = vi.fn();
vi.mock("@bis/db", () => ({
  getContact: (...a: unknown[]) => getContactMock(...a),
  contactMergePreview: (...a: unknown[]) => contactMergePreviewMock(...a),
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
  getContactMock.mockImplementation(async (_db: unknown, _accountId: string, id: string) => contact(id));
  contactMergePreviewMock.mockResolvedValue(PREVIEW_OK);
  screenProps.length = 0;
});

describe("the compare page: what it refuses, before any markup", () => {
  it("a non-uuid a or b 404s before any contact read", async () => {
    await expect(MergePage(ctx("nope", B))).rejects.toThrow(/NEXT_NOT_FOUND/);
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
});
