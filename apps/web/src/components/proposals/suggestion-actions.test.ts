import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SuggestionActions } from "./suggestion-actions";
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

describe("SuggestionActions stays off the registry and the database", () => {
  it("imports no value from @bis/db or lib/proposals/kinds (it is a client file)", () => {
    const src = readFileSync(join(__dirname, "suggestion-actions.tsx"), "utf8");
    expect(src).toMatch(/^"use client";/);
    expect(src).not.toMatch(/from ["']@bis\/db["']|lib\/proposals\/kinds/);
  });
});
