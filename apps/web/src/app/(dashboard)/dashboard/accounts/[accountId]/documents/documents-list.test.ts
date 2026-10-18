import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../contacts/documents-actions", () => ({
  trashDocumentAction: vi.fn(), restoreDocumentAction: vi.fn(), setOwnersOnlyAction: vi.fn(), undoOwnersOnlyAction: vi.fn(),
  getDocumentUrlAction: vi.fn(), updateDocumentFieldAction: vi.fn(), undoDocumentFieldAction: vi.fn(),
  startDocumentUploadAction: vi.fn(), finishDocumentUploadAction: vi.fn(), abandonDocumentUploadAction: vi.fn(),
  startDocumentVersionUploadAction: vi.fn(), purgeDocumentAction: vi.fn(),
}));
vi.mock("../contacts/document-requests-actions", () => ({
  createDocumentRequestAction: vi.fn(), documentRequestLinkAction: vi.fn(), revokeDocumentRequestAction: vi.fn(), undoRevokeDocumentRequestAction: vi.fn(),
}));
vi.mock("../contacts/document-requirements-actions", () => ({
  skipDocumentRequirementAction: vi.fn(), undoSkipDocumentRequirementAction: vi.fn(), unskipDocumentRequirementAction: vi.fn(), undoUnskipDocumentRequirementAction: vi.fn(),
}));
vi.mock("../contacts/document-shares-actions", () => ({
  createDocumentShareAction: vi.fn(), stopSharingAction: vi.fn(), undoStopSharingAction: vi.fn(),
}));
const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");
const { DocumentsList } = await import("./documents-list");
import type { DocumentsRowView } from "@/lib/documents/account-list";
import type { DocumentView } from "@/lib/documents/documents-load";

const TODAY = "2026-10-17";
const NOW = "2026-10-17T15:00:00.000Z";

/** A DocumentView with documents-load.ts's own fields; `scan` sets the shown version's state. */
function doc(over: Partial<DocumentView> & { scan?: DocumentView["version"]["scan"] } = {}): DocumentView {
  const { scan = "clean", ...rest } = over;
  const version = { id: `v-${rest.id ?? "d"}`, contentType: "application/pdf" as const, bytes: 1200, scan, createdAt: "2026-10-17T14:55:00.000Z" };
  return {
    id: "d", title: "File", category: "other", expiresOn: null, ownersOnly: false, source: "upload",
    addedBy: { you: false, name: "Ana" }, createdAt: "2026-10-10T15:00:00.000Z", addedOn: "2026-10-10", deletedAt: null,
    version, versions: [{ ...version, addedOn: "2026-10-17" }], purging: false, ...rest,
  };
}

const ROWS: DocumentsRowView[] = [
  { doc: doc({ id: "dA", title: "Liability policy", category: "insurance", expiresOn: "2026-10-29" }),
    filedOn: { name: "Ana García", href: "/dashboard/accounts/a1/contacts/c1" } },
  { doc: doc({ id: "dB", title: "City permit", category: "permit", expiresOn: "2026-10-14" }),
    filedOn: { name: "Luis Pérez", href: "/dashboard/accounts/a1/contacts/c2" } },
  { doc: doc({ id: "dC", title: "Roof photo", category: "photo", scan: "pending", ownersOnly: true }),
    filedOn: { name: "Casa García", href: "/dashboard/accounts/a1/groups/g1" } },
];

const render = (locale: "en" | "es" = "en") =>
  renderToStaticMarkup(createElement(DocumentsList, { accountId: "a1", locale, today: TODAY, now: NOW, rows: ROWS }));

/** One row's markup, from its opening <li> to its </li>. */
function row(html: string, id: string): string {
  const start = html.indexOf(`data-documents-page-row="${id}"`);
  expect(start, `row ${id}`).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf("<li", start);
  return html.slice(open, html.indexOf("</li>", start) + 5);
}

describe("the Documents page's rows (spec 3.1)", () => {
  it("three rows; each filed-on link has its record's href and sits OUTSIDE the row's open button (mutation: put the link inside the button -> FAILS)", () => {
    const html = render();
    expect(html).toContain("data-documents-page");
    expect(html.match(/data-documents-page-row=/g)).toHaveLength(3);
    for (const [id, href] of [["dA", "/dashboard/accounts/a1/contacts/c1"], ["dB", "/dashboard/accounts/a1/contacts/c2"], ["dC", "/dashboard/accounts/a1/groups/g1"]] as const) {
      const r = row(html, id);
      expect(r).toContain(`href="${href}"`);
      expect(r).toMatch(/<button[^>]*data-document-open/);
      expect(r).not.toMatch(/<button[^>]*data-document-open[^>]*>(?:(?!<\/button>)[\s\S])*<a\s/);
    }
    expect(renderedText(row(html, "dC"))).toContain("Casa García");
  });

  it("an expiry soon or past is a dot AND words; past is the --crit dot (rule 3; mutation: drop the dot -> FAILS)", () => {
    const html = render();
    const a = row(html, "dA");
    const b = row(html, "dB");
    expect(renderedText(a)).toContain("Expires in 12 days");
    expect(a).toContain("data-expiry-dot");
    expect(a).toContain("bg-[var(--warn)]");
    expect(renderedText(b)).toContain("Expired 3 days ago");
    expect(b).toMatch(/data-expiry-dot[^>]*bg-\[var\(--crit\)\]/);
  });

  it("a file still being checked shows its scan state, and Owners only; a clean file shows no scan state", () => {
    const html = render();
    const c = row(html, "dC");
    expect(c).toContain('data-document-scan="pending"');
    expect(renderedText(c)).toContain("Checking");
    expect(renderedText(c)).toContain("Owners only");
    expect(row(html, "dA")).not.toContain("data-document-scan");
    expect(row(html, "dA")).not.toContain("data-owners-only");
  });

  it("no checkboxes (rule 4: no bulk actions) and no primary button (rule 8)", () => {
    const html = render();
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('role="checkbox"');
    expect(html).not.toContain('data-variant="default"');
  });

  it("the row is the click target with a visible ring, and hovers to --surface-3 (rule 4)", () => {
    const a = row(render(), "dA");
    expect(a).toContain("hover:bg-[var(--surface-3)]");
    expect(a).toMatch(/<button[^>]*after:absolute after:inset-0[^>]*focus-visible:after:ring-\[3px\]/);
    expect(a).toMatch(/<a[^>]*relative z-10[^>]*focus-visible:ring-\[3px\]/);
  });

  it("the open button's name is the title, and its description is the row's facts line (review M3; mutation: drop aria-describedby -> FAILS)", () => {
    const html = render();
    const ids = new Set<string>();
    for (const id of ["dA", "dB", "dC"]) {
      const r = row(html, id);
      const described = /<button[^>]*data-document-open[^>]*aria-describedby="([^"]+)"|<button[^>]*aria-describedby="([^"]+)"[^>]*data-document-open/.exec(r);
      const factsId = described?.[1] ?? described?.[2];
      expect(factsId, `row ${id} describes its button`).toBeDefined();
      ids.add(factsId!);
      const facts = new RegExp(`<span[^>]*id="${factsId}"[^>]*>`).exec(r);
      expect(facts, `row ${id} has its facts line`).not.toBeNull();
      if (id === "dA") expect(renderedText(r.slice(facts!.index))).toContain("Expires in 12 days");
      if (id === "dC") expect(renderedText(r.slice(facts!.index))).toContain("Owners only");
    }
    expect(ids.size).toBe(3);
  });

  it("reads Spanish when the reader does, each against its literal", () => {
    expect(m["documents.ownersOnly.es"]).toBe("Solo dueños");
    const text = renderedText(render("es"));
    expect(text).toContain("Vence en 12 días");
    expect(text).toContain("Venció hace 3 días");
    expect(text).toContain("Seguro");
    expect(text).toContain("Solo dueños");
    expect(text).toContain("Revisando");
    expect(text).not.toContain("Owners only");
  });

  it("the page's viewer offers Copy share link too (S-07 3b; deviation 2: the viewer is shared by the card and the page; structure pin, the viewer closed in this static render; mutation: drop onShare -> FAILS)", () => {
    const src = readFileSync(fileURLToPath(new URL("./documents-list.tsx", import.meta.url)), "utf8");
    const open = src.indexOf("<DocumentViewer");
    expect(open).toBeGreaterThanOrEqual(0);
    const close = src.indexOf("/>", open);
    expect(close).toBeGreaterThan(open);
    expect(src.slice(open, close)).toContain("onShare={(d) => void handlers.copyShareLink(d)}");
  });
});
