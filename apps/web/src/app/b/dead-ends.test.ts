import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * D-109: a booking link's dead end was always the neutral `app/b/not-found.tsx`,
 * never the business's brand, even when the link named a real calendar.
 *
 * Where a dead end renders is decided by the ROUTE TREE, not by any component:
 * `notFound()` is caught by the nearest `not-found.tsx` at or above the
 * throwing page's own segment, and only a layout in THAT segment (or above)
 * wraps what it renders (next/dist/server/app-render/create-component-tree.js:
 * a segment's not-found element is handed to the LayoutRouter its own layout
 * renders as `children`). The deleted `app/b/[publicId]/layout.tsx` (#185)
 * failed on exactly this: it had no `not-found.tsx` beside it, so the throw
 * went past it to `app/b/not-found.tsx`, above the layout, which never got to
 * wrap anything. A rendered-component test cannot see that; this reads the
 * tree.
 *
 * Each page that calls `notFound()` for a real-but-unusable link must have a
 * `not-found.tsx` AND a `layout.tsx` in its own directory. The cancel page is
 * found by what it does, not where it sits, and the booking page's layout
 * must not be an ancestor of the cancel page: that layout would then run on
 * every cancel request and draw a second brand header over a working cancel
 * page (the second reason #185 removed it).
 */
const B = path.join(process.cwd(), "src", "app", "b");

function pagesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pagesUnder(full));
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

function pageCalling(marker: RegExp): string {
  const hits = pagesUnder(B).filter((p) => marker.test(fs.readFileSync(p, "utf8")));
  expect(hits, `exactly one page under app/b matches ${marker}`).toHaveLength(1);
  return hits[0]!;
}

const bookingPage = () => pageCalling(/!isCalendarLive\(calendar\)\)\s*notFound\(\)/);
const cancelPage = () => pageCalling(/if \(!row\) notFound\(\)/);
// F-048: the move page (`move/[token]`), which 404s an unknown token AND a
// booking of another calendar than the one its URL names.
const movePage = () => pageCalling(/if \(!ctx \|\| ctx\.calendar\.public_id !== publicId\) notFound\(\)/);

describe("app/b dead ends sit inside a layout that can brand them (D-109)", () => {
  for (const [name, find] of [["booking page", bookingPage], ["cancel page", cancelPage], ["move page", movePage]] as const) {
    it(`the ${name}'s own segment has a not-found.tsx and a layout.tsx`, () => {
      const dir = path.dirname(find());
      expect(fs.existsSync(path.join(dir, "not-found.tsx")), `${dir}/not-found.tsx`).toBe(true);
      expect(fs.existsSync(path.join(dir, "layout.tsx")), `${dir}/layout.tsx`).toBe(true);
    });
  }

  it("the booking page's layout wraps neither the cancel page nor the move page", () => {
    const bookingDir = path.dirname(bookingPage());
    for (const page of [cancelPage(), movePage()]) {
      const rel = path.relative(bookingDir, path.dirname(page));
      expect(rel.startsWith(".."), `${page} is inside ${bookingDir}`).toBe(true);
    }
  });
});
