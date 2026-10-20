import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { SuggestionActions, decisionFocusTarget, escCancelsEdit, focusPlan } from "./suggestion-actions";
import type { SuggestionEdit, SuggestionLabels } from "@/lib/proposals/view";

/** No DOM here (no jsdom): the markup a reader and a keyboard get, per mode. What the buttons DO is
 *  suggestion-handlers.test.ts's, and in the browser the e2e's (Task 10). */
const labels: SuggestionLabels = {
  accept: "Accept", editAccept: "Edit and accept", discard: "Discard", saveAccept: "Save and accept", cancel: "Cancel",
  undo: "Undo", title: "Title", due: "Due date", stage: "Stage", crashed: "That may not have gone through.", reload: "Reload",
  because: "Because the caller said", lang: "es",
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
  // Design review minor 7 (reversing Task 7's review minor 3): the field holds the model's English title
  // (P18), so under a Spanish card it says lang="en", as the title does in the card's sentence.
  it("the title field holding the model's English title says lang=\"en\" under a Spanish card (mutation: drop it -> FAILS)", () => {
    expect(html(TASK, "edit")).toMatch(/<input(?=[^>]*name="title")[^>]*\slang="en"/);
    expect(html({ kind: "contact_field", label: "Teléfono", value: "+1 956 555 0142" }, "edit")).not.toMatch(/<input[^>]*\slang=/);
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
  // Design review minor 1: the stage <select> is painted as every native field is (input.tsx's
  // nativeFieldClass on the input tokens), and shows a refusal as Input does.
  it("the stage select wears nativeFieldClass's field tokens and the invalid style (mutation: the old surface-2 copy -> FAILS)", () => {
    const cls = (/<select[^>]*class="([^"]*)"/.exec(html(STAGE, "edit"))?.[1] ?? "").split(" ");
    expect(cls).toEqual(expect.arrayContaining([
      "border-[var(--input-line)]", "bg-[var(--input-bg)]", "rounded-[var(--radius-ctl)]", "min-h-11", "aria-invalid:border-destructive",
    ]));
    expect(cls.filter((c) => c.includes("surface-"))).toEqual([]);
  });
  it("a field's form holds the suggested value under the field's own word", () => {
    const h = html({ kind: "contact_field", label: "Phone", value: "+1 956 555 0142" }, "edit");
    expect(h).toMatch(/<label[^>]*>Phone<\/label>/);
    expect(h).toMatch(/<input[^>]*name="value"[^>]*value="\+1 956 555 0142"/);
  });
});

/**
 * Design review minor 5, and 8b-2's I3: after a decision, focus must not fall to <body>. On the call page
 * the card stays and its status line takes focus; in a list it leaves, and the first of the plan's cards
 * still there takes it (the next card, else the previous one, else a card in a later list of the same
 * scope), else the first fallback heading present (spec 4.5). Until the page's re-render lands the card
 * still reads pending, so the caller waits. A fake document stands in for the DOM (there is no jsdom
 * here); the e2e proves it in the browser.
 */
function fakeDoc(cards: Record<string, string>, present: string[] = []) {
  const el = (name: string) => ({ name, focus: vi.fn() });
  const made = new Map<string, ReturnType<typeof el>>();
  const get = (name: string) => { if (!made.has(name)) made.set(name, el(name)); return made.get(name)!; };
  return {
    made,
    querySelector(sel: string) {
      if (present.includes(sel)) return get(sel);
      const m = /^\[data-suggestion="([^"]+)"\](?: (.+))?$/.exec(sel);
      if (!m || !(m[1]! in cards)) return null;
      const card = { getAttribute: (a: string) => (a === "data-status" ? cards[m[1]!]! : null) };
      if (!m[2]) return card;
      return get(`${m[1]} ${m[2]}`);
    },
  };
}
const plan = (candidates: string[], fallbacks: string[] = []) => ({ candidates, fallbacks });
describe("decisionFocusTarget (design review minor 5; 8b-2 design review I3)", () => {
  it("the card still reads pending: wait for the re-render", () => {
    const doc = fakeDoc({ sg_1: "pending", sg_2: "pending" });
    expect(decisionFocusTarget(doc as never, "sg_1", plan(["sg_2"]))).toEqual({ wait: true, el: null, heading: false });
  });
  it("the card stayed, decided (the call page): its status line (mutation: always the next Accept -> FAILS)", () => {
    const doc = fakeDoc({ sg_1: "accepted", sg_2: "pending" });
    expect(decisionFocusTarget(doc as never, "sg_1", plan(["sg_2"]))).toEqual({ wait: false, el: doc.made.get("sg_1 [data-status-line]"), heading: false });
  });
  it("the card left (the tray): the first planned card still there takes focus on its Accept", () => {
    const doc = fakeDoc({ sg_3: "pending" });
    expect(decisionFocusTarget(doc as never, "sg_1", plan(["sg_2", "sg_3"]))).toEqual({ wait: false, el: doc.made.get("sg_3 [data-suggestion-accept]"), heading: false });
  });
  it("no planned card is left: the first fallback heading present, never <body> (mutation: stop at the cards -> FAILS)", () => {
    const doc = fakeDoc({}, ["h1", '[data-record-card="next-up"] h2']);
    expect(decisionFocusTarget(doc as never, "sg_1", plan(["sg_2"], ["#gone", '[data-record-card="next-up"] h2', "h1"])))
      .toEqual({ wait: false, el: doc.made.get('[data-record-card="next-up"] h2'), heading: true });
    expect(decisionFocusTarget(fakeDoc({}) as never, "sg_1", plan([], ["h1"]))).toEqual({ wait: false, el: null, heading: false });
  });
});

/**
 * The client files of the suggestion card reach no `@bis/db` value (barrel or subpath: a bare
 * vi.mock("@bis/db") factory, and the browser bundle) and no server-only registry or view value. The
 * client-boundary.test.ts shape: a VALUE import counts, an `import type` is erased and does not.
 *
 * "Client file" means the CLIENT GRAPH, not only the files that say "use client" (final review, Task 7):
 * a file a "use client" file value-imports is in the browser bundle whatever its top line says
 * (suggestion-card.tsx, through the styleguide's demo). So the graph is walked from each directive file,
 * following value imports into this app's own src, and every file reached is scanned.
 */
const SERVER_VALUE_IMPORT =
  /import\s+(?!type\b)[^;'"]*?\s*from\s+["'](?:@bis\/db(?:\/[^"']*)?|[^"']*lib\/proposals\/(?:kinds|view)(?:\/[^"']*)?)["']/;
const SRC = resolve(__dirname, "../..");
const DIRECTIVE_FILES = [
  ...readdirSync(__dirname).filter((n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)).map((n) => join(__dirname, n)),
  join(SRC, "app/(dashboard)/dashboard/styleguide/suggestion-demo.tsx"),
].filter((p) => /^\s*["']use client["']/.test(readFileSync(p, "utf8")));
/** Every `import … from "x"` that is not `import type`, and every bare `import "x"`. */
const VALUE_SPECIFIERS = /import\s+(?:(?!type\b)[^;'"]*?\s*from\s+)?["']([^"']+)["']/g;
function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (base === null) return null;
  for (const p of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (/\.tsx?$/.test(p) && existsSync(p)) return p;
  }
  return null;
}
function clientGraph(roots: string[]): string[] {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(VALUE_SPECIFIERS)) {
      const next = resolveLocal(file, m[1]!);
      if (next) stack.push(next);
    }
  }
  return [...seen];
}
const CLIENT_FILES = clientGraph(DIRECTIVE_FILES);
const rel = (p: string) => relative(SRC, p).replace(/\\/g, "/");

describe("the suggestion card's client files stay off the registry and the database", () => {
  it("starts from every \"use client\" file in components/proposals and the styleguide demo", () => {
    expect(DIRECTIVE_FILES.map((p) => basename(p)).sort())
      .toEqual(["suggestion-actions.tsx", "suggestion-demo.tsx", "suggestion-retry.tsx"]);
  });
  it("walks into the files those import with no directive of their own: the card, its handlers and the mark's chip", () => {
    expect(CLIENT_FILES.map(rel)).toEqual(expect.arrayContaining([
      "components/proposals/suggestion-card.tsx",
      "components/proposals/suggestion-handlers.ts",
      "components/ai-mark.ts",
    ]));
  });
  it("none in the graph imports a value from @bis/db, any @bis/db subpath, lib/proposals/kinds or lib/proposals/view", () => {
    expect(CLIENT_FILES.filter((p) => SERVER_VALUE_IMPORT.test(readFileSync(p, "utf8"))).map(rel)).toEqual([]);
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

/**
 * The flat row's actions (item 8b-2, spec 5.3; DESIGN.md rule 8 as amended 2026-10-19: "A flat suggestion
 * row inside a record card has no primary at all"): ghost Accept and ghost Discard, and no Edit, which
 * happens in the tray.
 */
describe("SuggestionActions variant=\"row\" (the record's flat row)", () => {
  function rowHtml(edit: SuggestionEdit) {
    return renderToStaticMarkup(createElement(SuggestionActions, {
      id: "sg_1", edit, labels, accept: ok, editAccept: ok, discard: ok, undo, variant: "row",
    }));
  }
  it("exactly two buttons, Accept and Discard, both ghost: zero primary (mutation: keep Accept's default variant -> FAILS)", () => {
    for (const edit of [TASK, STAGE]) {
      const b = buttons(rowHtml(edit));
      expect(b.map((x) => [text(x), variant(x), typeOf(x)])).toEqual([
        ["Accept", "ghost", "button"],
        ["Discard", "ghost", "button"],
      ]);
      expect(b.filter((x) => variant(x) === "default")).toEqual([]);
    }
  });
  it("Accept still carries data-suggestion-accept, so focus can land on the next row's Accept", () => {
    expect(rowHtml(TASK)).toMatch(/<button[^>]*data-suggestion-accept[^>]*>Accept<\/button>/);
  });
  it("the card's variant is unchanged by default: one primary Accept", () => {
    expect(buttons(html(TASK)).filter((x) => variant(x) === "default").map(text)).toEqual(["Accept"]);
  });
});

/**
 * Where focus may go once a decided card leaves (item 8b-2; design review I3, spec 4.5), in order: the cards
 * after it in its own list (document order, across group boundaries: never the card's next DOM sibling,
 * which is a group heading at a group's last card), then the cards before it, nearest first (the record's
 * last Waiting row, an agency account's last card), then the cards of the later lists in the same scope
 * (the next account's first Accept), then the list's fallback headings. Pure.
 */
describe("focusPlan", () => {
  it("next in the list first, across a group boundary, then the previous card, nearest first (mutation: drop the previous cards -> FAILS)", () => {
    // Group A holds sg_1 and sg_2; group B holds sg_3. sg_2 is its group's last card.
    expect(focusPlan(["sg_1", "sg_2", "sg_3"], "sg_2", [], []).candidates).toEqual(["sg_3", "sg_1"]);
    expect(focusPlan(["sg_1", "sg_2", "sg_3"], "sg_3", [], []).candidates).toEqual(["sg_2", "sg_1"]);
  });
  it("an agency account's last card: then the next account's cards, then the fallbacks (mutation: later lists before the previous card -> FAILS)", () => {
    const p = focusPlan(["a_1", "a_2"], "a_2", ["a_1", "a_2", "b_1", "b_2"], ["#agency-suggestions", "h1"]);
    expect(p).toEqual({ candidates: ["a_1", "b_1", "b_2"], fallbacks: ["#agency-suggestions", "h1"] });
  });
  it("the only card: no candidate, only the fallbacks; an id not in the list has no neighbours", () => {
    expect(focusPlan(["sg_1"], "sg_1", [], ["h1"])).toEqual({ candidates: [], fallbacks: ["h1"] });
    expect(focusPlan(["sg_1"], "sg_9", [], []).candidates).toEqual([]);
  });
});
