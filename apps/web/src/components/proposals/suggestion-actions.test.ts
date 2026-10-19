import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { SuggestionActions, escCancelsEdit } from "./suggestion-actions";
import type { SuggestionEdit, SuggestionLabels } from "@/lib/proposals/view";

/** No DOM here (no jsdom): the markup a reader and a keyboard get, per mode. What the buttons DO is
 *  suggestion-handlers.test.ts's, and in the browser the e2e's (Task 10). */
const labels: SuggestionLabels = {
  accept: "Accept", editAccept: "Edit and accept", discard: "Discard", saveAccept: "Save and accept", cancel: "Cancel",
  undo: "Undo", title: "Title", due: "Due date", stage: "Stage", crashed: "That may not have gone through.",
  because: "Because the caller said",
};
const ok = async () => ({ ok: true as const, status: "accepted" as const, toast: "Done" });
const undo = async () => ({ ok: true as const, message: "Undone." });

function html(edit: SuggestionEdit, initialMode?: "view" | "edit") {
  return renderToStaticMarkup(createElement(SuggestionActions, {
    id: "sg_1", edit, labels, accept: ok, editAccept: ok, discard: ok, undo, initialMode,
  }));
}
const buttons = (h: string) => h.match(/<button[^>]*>.*?<\/button>/g) ?? [];
const variant = (b: string) => /data-variant="([a-z]+)"/.exec(b)?.[1];
const typeOf = (b: string) => /type="([a-z]+)"/.exec(b)?.[1];
const text = (b: string) => b.replace(/<[^>]*>/g, "");
const TASK: SuggestionEdit = { kind: "task", title: "Call back about the quote", dueDate: "2026-10-21" };
const STAGE: SuggestionEdit = {
  kind: "opportunity_stage", options: [{ id: "st_quote", name: "Quote sent" }, { id: "st_follow", name: "Following up" }], toStageId: "st_quote",
};

describe("SuggestionActions: one primary per card (rule 8, P12)", () => {
  it("pending: Accept is the ONE default button; Edit and accept and Discard are ghost; all type=button", () => {
    const b = buttons(html(TASK));
    expect(b.map((x) => [text(x), variant(x), typeOf(x)])).toEqual([
      ["Accept", "default", "button"],
      ["Edit and accept", "ghost", "button"],
      ["Discard", "ghost", "button"],
    ]);
  });
  it("edit mode: Save and accept is the ONE default and the form's submit; Cancel is ghost and type=button", () => {
    const h = html(TASK, "edit");
    const b = buttons(h);
    expect(b.map((x) => [text(x), variant(x), typeOf(x)])).toEqual([
      ["Save and accept", "default", "submit"],
      ["Cancel", "ghost", "button"],
    ]);
    expect(h).toMatch(/<form[^>]*>[\s\S]*type="submit"[\s\S]*<\/form>/);
  });
});

describe("SuggestionActions: the edit forms", () => {
  it("the editable title carries no lang of its own: the reader may write in either language (review minor 3)", () => {
    expect(html(TASK, "edit")).not.toMatch(/<input(?=[^>]*name="title")[^>]*\slang=/);
  });
  it("a stage move with no later stage to pick offers no Edit and accept (review minor 4)", () => {
    const b = buttons(html({ kind: "opportunity_stage", options: [], toStageId: "st_quote" }));
    expect(b.map(text)).toEqual(["Accept", "Discard"]);
  });
  it("Esc cancels the edit from a field, but not from the stage select, whose own Esc closes its list (review minor 8)", () => {
    expect([escCancelsEdit("Escape", "INPUT"), escCancelsEdit("Escape", "SELECT"), escCancelsEdit("Enter", "INPUT")])
      .toEqual([true, false, false]);
  });
  it("a to-do's form has its title and an <input type=date> holding the view's due date", () => {
    const h = html(TASK, "edit");
    expect(h).toMatch(/<input[^>]*name="title"[^>]*value="Call back about the quote"/);
    expect(h).toMatch(/<input[^>]*type="date"[^>]*name="dueAt"[^>]*value="2026-10-21"|<input[^>]*name="dueAt"[^>]*type="date"[^>]*value="2026-10-21"/);
  });
  it("a stage's form is a <select> with exactly the view's options, the suggested one selected", () => {
    const h = html(STAGE, "edit");
    const select = /<select[^>]*name="toStageId"[^>]*>([\s\S]*?)<\/select>/.exec(h)?.[1] ?? "";
    expect([...select.matchAll(/<option value="([^"]+)"( selected="")?>([^<]*)<\/option>/g)].map((x) => [x[1], !!x[2], x[3]]))
      .toEqual([["st_quote", true, "Quote sent"], ["st_follow", false, "Following up"]]);
  });
  it("a field's form holds the suggested value under the field's own word", () => {
    const h = html({ kind: "contact_field", label: "Phone", value: "+1 956 555 0142" }, "edit");
    expect(h).toMatch(/<label[^>]*>Phone<\/label>/);
    expect(h).toMatch(/<input[^>]*name="value"[^>]*value="\+1 956 555 0142"/);
  });
});

/**
 * The client files of the suggestion card reach no `@bis/db` value (barrel or subpath: a bare
 * vi.mock("@bis/db") factory, and the browser bundle) and no server-only registry or view value. The
 * client-boundary.test.ts shape: a VALUE import counts, an `import type` is erased and does not.
 */
const SERVER_VALUE_IMPORT =
  /import\s+(?!type\b)[^;'"]*?\s*from\s+["'](?:@bis\/db(?:\/[^"']*)?|[^"']*lib\/proposals\/(?:kinds|view)(?:\/[^"']*)?)["']/;
const CLIENT_FILES = [
  ...readdirSync(__dirname).filter((n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)).map((n) => join(__dirname, n)),
  join(__dirname, "../../app/(dashboard)/dashboard/styleguide/suggestion-demo.tsx"),
].filter((p) => /^\s*["']use client["']/.test(readFileSync(p, "utf8")));

describe("the suggestion card's client files stay off the registry and the database", () => {
  it("scans every \"use client\" file in components/proposals and the styleguide demo", () => {
    expect(CLIENT_FILES.map((p) => basename(p)).sort())
      .toEqual(["suggestion-actions.tsx", "suggestion-demo.tsx", "suggestion-retry.tsx"]);
  });
  it("none imports a value from @bis/db, any @bis/db subpath, lib/proposals/kinds or lib/proposals/view", () => {
    expect(CLIENT_FILES.filter((p) => SERVER_VALUE_IMPORT.test(readFileSync(p, "utf8")))).toEqual([]);
  });
  it("the scan's own shapes: barrel and subpath value imports count, multi-line counts, a type import does not", () => {
    expect([
      `import { addTask } from "@bis/db";`,
      `import { effectiveStatus } from "@bis/db/proposal-rules";`,
      `import {\n  KINDS,\n} from "@/lib/proposals/kinds";`,
      `import { buildSuggestionView } from "@/lib/proposals/view";`,
      `import type { SuggestionView } from "@/lib/proposals/view";`,
      `import type { Proposal } from "@bis/db/proposal-rules";`,
    ].map((s) => SERVER_VALUE_IMPORT.test(s))).toEqual([true, true, true, true, false, false]);
  });
});
