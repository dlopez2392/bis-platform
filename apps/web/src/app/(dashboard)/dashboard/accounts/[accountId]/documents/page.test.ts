import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const listAccountDocuments = vi.fn<(...a: unknown[]) => Promise<unknown[]>>();
const countAccountDocuments = vi.fn<(...a: unknown[]) => Promise<number>>();
const listPeopleNames = vi.fn<(...a: unknown[]) => Promise<Record<string, string>>>();
const getRequiredDocumentCategories = vi.fn<(...a: unknown[]) => Promise<string[]>>();
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listAccountDocuments: (...a: unknown[]) => listAccountDocuments(...a),
  countAccountDocuments: (...a: unknown[]) => countAccountDocuments(...a),
  listPeopleNames: (...a: unknown[]) => listPeopleNames(...a),
  getRequiredDocumentCategories: (...a: unknown[]) => getRequiredDocumentCategories(...a),
}));
const access = vi.hoisted(() => ({ value: { userId: "u1", isAgency: false, role: "owner" as string | null, canManage: true } }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => access.value,
}));
vi.mock("./required-documents-summary", () => ({
  RequiredDocumentsSummary: (p: unknown) => createElement("div", { "data-summary-mock": JSON.stringify(p) }),
}));
vi.mock("../settings/document-requirements-actions", () => ({ setRequiredDocumentCategoriesAction: vi.fn() }));
vi.mock("./required-documents-actions", () => ({ undoRequiredDocumentsAction: vi.fn() }));
const DB = {
  from: (table: string) => {
    if (table !== "accounts") throw new Error(`unexpected read of ${table}`);
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { language: null }, error: null }) }) }) };
  },
};
vi.mock("@/lib/db", () => ({ dbForRequest: async () => DB }));
const prefs = vi.fn(async (): Promise<{ language: "en" | "es" | null }> => ({ language: null }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: () => prefs() }));
// A far date (review M3): a page that took "today" from the server's own clock instead of documentsClock FAILS case 1.
vi.mock("@/lib/documents/document-view", async () => ({
  documentsClock: async () => ({ today: "2030-03-01", zone: "America/Chicago" }),
  documentView: (await vi.importActual<typeof import("@/lib/documents/document-view")>("@/lib/documents/document-view")).documentView,
}));
vi.mock("./documents-list", () => ({ DocumentsList: (p: unknown) => createElement("div", { "data-list-mock": JSON.stringify(p) }) }));
vi.mock("./category-filter", () => ({ CategoryFilter: (p: unknown) => createElement("div", { "data-filter-mock": JSON.stringify(p) }) }));

const { renderedText } = await import("@/lib/rendered-text");
const { encodeCursor } = await import("@/lib/cursor");
const { default: DocumentsPage } = await import("./page");

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
let n = 0;
/** One AccountDocument as listAccountDocuments answers it (a ListedDocument plus its contact or group). */
function row(over: Record<string, unknown> = {}) {
  n += 1;
  const id = `0f8fad5b-d9cb-469f-a165-${String(n).padStart(12, "0")}`;
  const version = { id: `v${n}`, document_id: id, content_type: "application/pdf", bytes: 1200, scan_status: "clean", scan_signature: null,
    created_at: "2030-02-01T15:00:00.000Z", created_by: "u2" };
  return {
    id, account_id: "a1", contact_id: "c1", client_group_id: null, place_id: null, opportunity_id: null, title: `File ${n}`,
    category: "insurance", expires_on: "2030-03-10", owners_only: false, source: "upload", current_version_id: version.id,
    created_by: "u2", created_at: "2030-02-01T15:00:00.000Z", deleted_at: null, deleted_by: null,
    version, versions: [version], contact: { id: "c1", first_name: "Ana", last_name: "García" }, group: null, ...over,
  };
}

async function render(sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await DocumentsPage({ params: Promise.resolve({ accountId: "a1" }), searchParams: Promise.resolve(sp) }));
}
const listProps = (html: string) => {
  const raw = /data-list-mock="([^"]*)"/.exec(html)?.[1];
  expect(raw, "the list mock rendered").toBeDefined();
  return JSON.parse(raw!.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'")) as { rows: unknown[]; today: string; locale: string };
};

/** The href of the ONE <a> whose content holds `text` (review I2: a bare href check is also met by the Expiring soon pill). */
function linkHref(html: string, text: string): string | undefined {
  const links = [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>((?:(?!<\/a>)[\s\S])*)<\/a>/g)].filter((x) => x[2]!.includes(text));
  expect(links, `links reading ${text}`).toHaveLength(1);
  return links[0]![1]!.replace(/&amp;/g, "&");
}

beforeEach(() => {
  n = 0;
  listAccountDocuments.mockReset().mockResolvedValue([row(), row()]);
  countAccountDocuments.mockReset().mockResolvedValue(7);
  listPeopleNames.mockReset().mockResolvedValue({ u2: "Rosa" });
  getRequiredDocumentCategories.mockReset().mockResolvedValue(["id", "insurance"]);
  prefs.mockReset().mockResolvedValue({ language: null });
  access.value = { userId: "u1", isAgency: false, role: "owner", canManage: true };
});

describe("the Documents page (spec 3.1)", () => {
  it("reads Expiring soon in the ACCOUNT's day, one more row than a page, and states the REAL total (mutation: count = rows.length -> FAILS)", async () => {
    const html = await render();
    const filter = { show: "expiring", category: null, today: "2030-03-01" };
    expect(listAccountDocuments).toHaveBeenCalledWith(DB, "a1", filter, { before: undefined, limit: 51 });
    expect(countAccountDocuments).toHaveBeenCalledWith(DB, "a1", filter);
    expect(renderedText(html)).toContain("7 files");
    expect(listProps(html).today).toBe("2030-03-01");
    expect(listProps(html).rows).toHaveLength(2);
  });

  it("a count that fails rejects the page, so the error boundary shows (mutation: .catch(() => 0) -> FAILS)", async () => {
    countAccountDocuments.mockRejectedValue(new Error("countAccountDocuments failed: no count returned"));
    await expect(render()).rejects.toThrow("no count returned");
  });

  it("51 rows: the list gets 50 and the one pager has Next carrying before=, no Back to the start on page one", async () => {
    const rows = Array.from({ length: 51 }, () => row());
    listAccountDocuments.mockResolvedValue(rows);
    const html = await render();
    expect(listProps(html).rows).toHaveLength(50);
    expect(html.match(/data-documents-pager/g)).toHaveLength(1);
    const next = /<a[^>]*href="([^"]*)"[^>]*>(?:(?!<\/a>)[\s\S])*Next/.exec(html)?.[1]?.replace(/&amp;/g, "&");
    expect(next).toBe(`/dashboard/accounts/a1/documents?show=expiring&before=${encodeCursor({ v: "2030-03-10", id: rows[49]!.id })}`);
    expect(renderedText(html)).not.toContain("Back to the start");
  });

  it("a cursored page passes its cursor and offers Back to the start", async () => {
    const before = encodeCursor({ v: "2030-03-05", id: ID });
    const html = await render({ before });
    expect(listAccountDocuments).toHaveBeenCalledWith(DB, "a1", expect.anything(), { before: { v: "2030-03-05", id: ID }, limit: 51 });
    expect(linkHref(html, "Back to the start")).toBe("/dashboard/accounts/a1/documents?show=expiring");
  });

  it("an impossible cursor day is page one, never the error state", async () => {
    await render({ before: encodeCursor({ v: "2030-02-30", id: ID }) });
    expect(listAccountDocuments).toHaveBeenCalledWith(DB, "a1", expect.anything(), { before: undefined, limit: 51 });
  });

  it.each([
    ["expiring", "Nothing expires in the next 30 days.", "Files with an expiry date show up here a month before."],
    ["expired", "Nothing has expired.", null],
    ["all", "Files you upload to a customer or household show up here.", "Open a customer and use Documents to add one."],
  ] as const)("an empty cold start on %s says what shows up here", async (show, title, body) => {
    listAccountDocuments.mockResolvedValue([]);
    countAccountDocuments.mockResolvedValue(0);
    const html = await render({ show });
    const text = renderedText(html);
    expect(text).toContain(title);
    if (body) expect(text).toContain(body);
    expect(html).not.toContain("data-list-mock");
  });

  it("a cursored empty page shows the start link and NO empty state", async () => {
    listAccountDocuments.mockResolvedValue([]);
    countAccountDocuments.mockResolvedValue(3);
    const html = await render({ show: "expired", before: encodeCursor({ v: "2030-01-01", id: ID }) });
    expect(linkHref(html, "Back to the start")).toBe("/dashboard/accounts/a1/documents?show=expired");
    expect(renderedText(html)).not.toContain("Nothing has expired.");
  });

  it("the three show pills mark the current one only; ?show=expired marks Expired", async () => {
    const pills = (html: string) => [...html.matchAll(/<a[^>]*href="\/dashboard\/accounts\/a1\/documents\?show=(\w+)"[^>]*>/g)]
      .filter((x) => !x[0].includes("before")).map((x) => ({ show: x[1], current: x[0].includes('aria-current="page"') }));
    expect(pills(await render())).toEqual([
      { show: "expiring", current: true }, { show: "expired", current: false }, { show: "all", current: false },
    ]);
    expect(pills(await render({ show: "expired" }))).toEqual([
      { show: "expiring", current: false }, { show: "expired", current: true }, { show: "all", current: false },
    ]);
  });

  it("the category select gets Any plus the nine, each with its server-built href, and a pill keeps the category", async () => {
    const html = await render({ show: "expired", category: "permit" });
    const raw = /data-filter-mock="([^"]*)"/.exec(html)![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    const p = JSON.parse(raw) as { current: string; options: { value: string; label: string; href: string }[] };
    expect(p.current).toBe("permit");
    expect(p.options.map((o) => o.value)).toEqual(["", "id", "contract", "estimate", "invoice", "photo", "permit", "insurance", "warranty", "other"]);
    expect(p.options[0]).toEqual({ value: "", label: "Any type", href: "/dashboard/accounts/a1/documents?show=expired" });
    expect(p.options[6]).toEqual({ value: "permit", label: "Permit or license", href: "/dashboard/accounts/a1/documents?show=expired&category=permit" });
    expect(html).toContain('href="/dashboard/accounts/a1/documents?show=all&amp;category=permit"');
    expect(listAccountDocuments).toHaveBeenCalledWith(DB, "a1", { show: "expired", category: "permit", today: "2030-03-01" }, expect.anything());
  });

  it("reads Spanish when the reader does, against the literals, and sets lang", async () => {
    prefs.mockResolvedValue({ language: "es" });
    const html = await render();
    const text = renderedText(html);
    expect(text).toContain("Documentos");
    expect(text).toContain("Vencen pronto");
    expect(text).toContain("7 archivos");
    expect(html).toContain('lang="es"');
    expect(listProps(html).locale).toBe("es");
  });

  it("names no hero (rule 11)", async () => {
    expect(await render()).not.toContain("data-hero");
  });

  it("an Owner gets the Required documents card mounted BEFORE the list, with the required list it read", async () => {
    const html = await render();
    expect(getRequiredDocumentCategories).toHaveBeenCalledWith(DB, "a1");
    const summaryAt = html.indexOf("data-summary-mock");
    const listAt = html.indexOf("data-list-mock");
    expect(summaryAt).toBeGreaterThan(-1);
    expect(summaryAt).toBeLessThan(listAt);
    const raw = /data-summary-mock="([^"]*)"/.exec(html)![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    expect((JSON.parse(raw) as { required: string[] }).required).toEqual(["id", "insurance"]);
  });

  it("a Staff member gets no summary and the required list is never read (mutation: render it for everyone -> FAILS)", async () => {
    access.value = { userId: "u2", isAgency: false, role: "staff", canManage: false };
    const html = await render();
    expect(html).not.toContain("data-summary-mock");
    expect(getRequiredDocumentCategories).not.toHaveBeenCalled();
  });
});
