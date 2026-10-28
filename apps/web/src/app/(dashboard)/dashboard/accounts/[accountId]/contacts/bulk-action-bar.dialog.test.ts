import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

// The bulk delete dialog's body, RENDERED (Task 10 review: a source regex passes on a dead branch). Radix's
// Dialog portals its content and renders nothing in a static render, so the primitives become plain elements
// here, each marked, and the body is rendered with the state the bar would hand it.
vi.mock("@/components/ui/dialog", () => {
  const el = (tag: string, mark: string) => {
    const Marked = ({ children }: { children?: ReactNode }) => createElement(tag, { [mark]: "" }, children);
    Marked.displayName = `Marked(${mark})`;
    return Marked;
  };
  return {
    Dialog: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
    DialogContent: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
    DialogHeader: el("header", "data-header"),
    DialogTitle: el("h2", "data-title"),
    DialogDescription: el("p", "data-description"),
    DialogFooter: el("footer", "data-footer"),
  };
});
vi.mock("./actions", () => ({}));
vi.mock("./archive-actions", () => ({}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { DeleteDialogBody } = await import("./bulk-action-bar");
type Props = Parameters<typeof DeleteDialogBody>[0];

const noop = () => {};
function render(over: Partial<Props>): string {
  return renderToStaticMarkup(createElement(DeleteDialogBody, {
    count: 3, typed: "", onTyped: noop, files: { status: "ready", count: 0 }, blockers: { status: "loading" },
    view: "active", canArchive: true, paused: false, locale: "en", onCancel: noop, onArchiveInstead: noop, onDelete: noop,
    ...over,
  } as Props));
}
const part = (html: string, mark: string) => {
  const hit = html.match(new RegExp(`<[a-z0-9]+ ${mark}="">([\\s\\S]*?)</[a-z0-9]+>`));
  return hit ? renderedText(hit[1]!).trim() : null;
};
const buttons = (html: string) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
  .map((b) => ({ text: renderedText(b[2]!).trim(), disabled: /\sdisabled=""/.test(b[1]!) }));
const ready = (kept: string[]) => ({ status: "ready" as const, kept });

describe("the bulk delete dialog, rendered (spec §5.4; Task 10 review)", () => {
  it("while the blockers load: the selection's count in the title, the kept line as a skeleton, no file line, Delete off (rule 7)", () => {
    const html = render({ typed: "3" });
    expect(part(html, "data-title")).toBe("Delete 3 contacts?");
    expect(html).toContain("data-delete-kept-skeleton");
    expect(html).not.toContain("data-delete-files");
    expect(buttons(html).find((b) => b.text === m["bulk.delete"])?.disabled).toBe(true);
  });

  it("some kept: the title and the typed number are the DELETABLE count, the kept line in the singular, the files line, and Delete on at that number (mutation: title the selection -> FAILS)", () => {
    const html = render({ blockers: ready(["c3"]), typed: "2", files: { status: "ready", count: 4 } });
    expect(part(html, "data-title")).toBe("Delete 2 contacts?");
    expect(part(html, "data-description")).toBe("This can't be undone. Type 2 to confirm.");
    expect(html).toContain("1 of these has a history with you and will be kept.");
    expect(html).toContain("This also deletes 4 files.");
    expect(html).toContain('placeholder="2"');
    expect(buttons(html).find((b) => b.text === m["bulk.delete"])?.disabled).toBe(false);
  });

  it("nothing deletable on the list: the none title, the none sentence once (no kept line repeating it), Archive instead, and no Delete and no box (mutation: keep the Delete title -> FAILS)", () => {
    const html = render({ blockers: ready(["c1", "c2", "c3"]) });
    expect(part(html, "data-title")).toBe("These can't be deleted");
    expect(part(html, "data-description")).toBe(m["contacts.delete.noneDeletable"]);
    expect(html).not.toContain("will be kept");
    expect(html).not.toContain("<input");
    const names = buttons(html).map((b) => b.text);
    expect(names).toEqual([m["common.cancel"], m["contacts.delete.archiveInstead"]]);
    expect(names.filter((n) => /delete/i.test(n))).toEqual([]);
  });

  it("nothing deletable at one: the singular title and sentence", () => {
    const html = render({ count: 1, blockers: ready(["c1"]) });
    expect(part(html, "data-title")).toBe("This contact can't be deleted");
    expect(part(html, "data-description")).toBe("They have a history with you, so they can't be deleted. Archive them instead.");
  });

  it("nothing deletable in the ARCHIVED view: they stay archived, and nothing offers to archive them again (Task 10 review I1; mutation: ignore view -> FAILS)", () => {
    const html = render({ view: "archived", blockers: ready(["c1", "c2", "c3"]) });
    expect(part(html, "data-description")).toBe("None of these can be deleted: they all have a history with you, so they stay archived.");
    expect(buttons(html).map((b) => b.text)).toEqual([m["common.cancel"]]);
    const es = render({ view: "archived", count: 1, blockers: ready(["c1"]), locale: "es" });
    expect(part(es, "data-title")).toBe("Este contacto no se puede borrar");
    expect(part(es, "data-description")).toBe("Tiene un historial con usted, así que no se puede borrar. Sigue archivado.");
  });

  it("a reader who does not archive gets no Archive instead either", () => {
    expect(buttons(render({ canArchive: false, blockers: ready(["c1", "c2", "c3"]) })).map((b) => b.text)).toEqual([m["common.cancel"]]);
  });

  it("a failed blockers read says so and Delete stays off, whatever is typed (rule 5)", () => {
    const html = render({ blockers: { status: "error" }, typed: "3" });
    expect(renderedText(html)).toContain(m["contacts.delete.blockersFailed"]);
    expect(buttons(html).find((b) => b.text === m["bulk.delete"])?.disabled).toBe(true);
  });

  it("a paused account: Delete stays off at the right number, and the dialog says why (final review M3; mutation: ignore paused -> FAILS)", () => {
    const html = render({ blockers: ready([]), typed: "3", paused: true });
    expect(buttons(html).find((b) => b.text === m["bulk.delete"])?.disabled).toBe(true);
    expect(html).toContain(m["contacts.delete.paused"]);
    expect(buttons(render({ blockers: ready([]), typed: "3" })).find((b) => b.text === m["bulk.delete"])?.disabled).toBe(false);
  });

  it("Spanish throughout", () => {
    const html = render({ blockers: ready(["c3"]), locale: "es" });
    expect(part(html, "data-title")).toBe("¿Borrar 2 contactos?");
    expect(html).toContain("1 de estos tiene un historial con usted y se conservará.");
  });
});
