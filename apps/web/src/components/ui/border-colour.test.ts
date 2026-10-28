// apps/web/src/components/ui/border-colour.test.ts
//
// Found 2026-10-28 by a built-app design check: the shared table's row rule
// was a bare `border-b`. This app's globals carry no shadcn
// `* { @apply border-border }` base rule, so Tailwind's preflight leaves every
// border's colour at `currentColor` — a 1px near-black rule under every row
// in light and a bright white one in dark, instead of the `--row-line` token
// every hand-built row rule in the app already uses.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Table, TableBody, TableFooter, TableRow, TableCell } from "./table";

const here = path.dirname(fileURLToPath(import.meta.url));

const classOf = (html: string, slot: string) => {
  const m = html.match(new RegExp(`<[a-z]+[^>]*data-slot="${slot}"[^>]*class="([^"]*)"`))
    ?? html.match(new RegExp(`<[a-z]+[^>]*class="([^"]*)"[^>]*data-slot="${slot}"`));
  expect(m, `no ${slot} in ${html}`).not.toBeNull();
  return m![1]!;
};

describe("table rules paint the row-line token, never currentColor (2026-10-28)", () => {
  it("TableRow's bottom rule is --row-line", () => {
    const html = renderToStaticMarkup(
      createElement(Table, null,
        createElement(TableBody, null,
          createElement(TableRow, null, createElement(TableCell, null, "x")))),
    );
    expect(classOf(html, "table-row")).toMatch(/(^|\s)border-\[var\(--row-line\)\](\s|$)/);
  });

  it("TableFooter's top rule is --row-line", () => {
    const html = renderToStaticMarkup(
      createElement(Table, null,
        createElement(TableFooter, null,
          createElement(TableRow, null, createElement(TableCell, null, "x")))),
    );
    expect(classOf(html, "table-footer")).toMatch(/(^|\s)border-\[var\(--row-line\)\](\s|$)/);
  });
});

// The general guard: in components/ui, any class literal that turns a border
// or an outline ON must also name its colour in the same literal. A width
// utility with no colour is the defect above waiting to recur.
const WIDTH = /(^|\s)((?:[^\s"]*:)?)(border(?:-[trblxy])?|outline(?:-\d+)?)(?=\s|$)/g;
const BORDER_COLOUR = /(^|\s)(?:[^\s"]*:)?border(?:-[trblxy])?-(\[var\(--[a-z0-9-]+\)\]|border|input|transparent|ring|destructive)(?=[\s/]|$)/;
const OUTLINE_COLOUR = /(^|\s)(?:[^\s"]*:)?outline-(\[var\(--[a-z0-9-]+\)\]|ring)(?=[\s/]|$)/;

// The sheet's side literals carry only the width; its colour,
// `border-[var(--line-strong)]`, sits in the base literal of the same cn(),
// which the next case asserts directly so the exemption cannot go stale.
const EXEMPT: Record<string, RegExp> = {
  "sheet.tsx": /^inset-/,
};

describe("components/ui: no border or outline without a colour (2026-10-28)", () => {
  const files = readdirSync(here).filter((f) => f.endsWith(".tsx"));

  it("scans the ui directory", () => {
    expect(files).toEqual(expect.arrayContaining(["table.tsx", "command.tsx", "sheet.tsx"]));
  });

  for (const file of files) {
    it(`${file}: every border/outline literal names a colour`, () => {
      const text = readFileSync(path.join(here, file), "utf8");
      const offenders: string[] = [];
      for (const [, prop, literal] of text.matchAll(/(variant=)?"([^"\n]*)"/g)) {
        // `variant="outline"` is a prop value, not a class list.
        if (!literal || prop) continue;
        const widths = [...literal.matchAll(WIDTH)];
        if (widths.length === 0) continue;
        if (EXEMPT[file]?.test(literal)) continue;
        const needsBorder = widths.some((w) => w[3]!.startsWith("border"));
        const needsOutline = widths.some((w) => w[3]!.startsWith("outline"));
        if (needsBorder && !BORDER_COLOUR.test(literal)) offenders.push(literal);
        else if (needsOutline && !OUTLINE_COLOUR.test(literal)) offenders.push(literal);
      }
      expect(offenders).toEqual([]);
    });
  }

  it("the sheet's exemption holds: its base literal names the border colour", () => {
    const text = readFileSync(path.join(here, "sheet.tsx"), "utf8");
    expect(text).toMatch(/"fixed z-50 [^"]*border-\[var\(--line-strong\)\]/);
  });
});
