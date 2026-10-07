import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { isToasterTarget, interactOutsideExemptingToaster } from "./interact-outside";

const here = path.dirname(fileURLToPath(import.meta.url));

// Duck-typed stand-ins for DOM `Element`s — this suite runs in vitest's
// default node environment (vitest.config.ts), which has no `Element`
// global to construct a real one from.
const toasterDescendant = { closest: (sel: string) => (sel === "[data-sonner-toaster]" ? {} : null) } as unknown as EventTarget;
const outsideElement = { closest: () => null } as unknown as EventTarget;

function fakeEvent(target: EventTarget | null) {
  const event = {
    target,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
  };
  return event;
}

describe("isToasterTarget", () => {
  it("is true for an element inside [data-sonner-toaster]", () => {
    expect(isToasterTarget(toasterDescendant)).toBe(true);
  });
  it("is false for an element outside the toaster", () => {
    expect(isToasterTarget(outsideElement)).toBe(false);
  });
  it("is false for null", () => {
    expect(isToasterTarget(null)).toBe(false);
  });
  it("is false for a non-element target with no closest()", () => {
    expect(isToasterTarget({} as unknown as EventTarget)).toBe(false);
  });
});

describe("interactOutsideExemptingToaster", () => {
  it("a target inside the toaster: prevents default and does not call the caller's handler", () => {
    const onInteractOutside = vi.fn();
    const handler = interactOutsideExemptingToaster(onInteractOutside);
    const event = fakeEvent(toasterDescendant);
    handler(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onInteractOutside).not.toHaveBeenCalled();
  });
  it("a target outside the toaster: does not prevent default and calls the caller's handler with the same event", () => {
    const onInteractOutside = vi.fn();
    const handler = interactOutsideExemptingToaster(onInteractOutside);
    const event = fakeEvent(outsideElement);
    handler(event);
    expect(event.defaultPrevented).toBe(false);
    expect(onInteractOutside).toHaveBeenCalledExactlyOnceWith(event);
  });
  it("no caller handler, outside target: does not throw and does not prevent default", () => {
    const handler = interactOutsideExemptingToaster(undefined);
    const event = fakeEvent(outsideElement);
    expect(() => handler(event)).not.toThrow();
    expect(event.defaultPrevented).toBe(false);
  });
  it("a null target: does not prevent default", () => {
    const onInteractOutside = vi.fn();
    const handler = interactOutsideExemptingToaster(onInteractOutside);
    const event = fakeEvent(null);
    handler(event);
    expect(event.defaultPrevented).toBe(false);
    expect(onInteractOutside).toHaveBeenCalledExactlyOnceWith(event);
  });
});

// Mutation (4)'s catch: the predicate/composition tests above call the
// shared factory directly and cannot see whether either component actually
// wires it in. A source-TEXT `toContain("interactOutsideExemptingToaster(")`
// check (the prior version of this test) stays green when the call only
// appears in a comment next to the raw prop, or is made and its result
// thrown away (review of f9789e94, m1) — so this reads the parsed AST
// instead: comments are trivia the parser drops before an expression node
// ever exists, so they cannot satisfy this.
//
// Review of 2c868ca4 (mutation P1): an earlier version of this walk kept a
// single `found` variable, overwritten on every `*.Content` match across the
// WHOLE FILE — so it actually read whichever such element came LAST in
// document order. A decoy `*.Content` wired correctly and placed after a
// really-broken `SheetContent`/`DialogContent` stayed green 10/10. This walk
// is scoped to the function declaration the `it.each` row names (the one
// actually under test), not the whole file, so a decoy anywhere else — under
// any other name, however many of them — is never even visited.
//
// Review of a7f73364 (mutations S2, S3): the walk used to push one `hits`
// entry per onInteractOutside ATTRIBUTE it found on a `*.Content` element, so
// a second `*.Content` element in the same function with NO such attribute
// contributed nothing and vanished from the count — a correctly-wired real
// element plus an unwired second one (S2), or a BROKEN real element (its
// attribute removed) plus a hidden second element carrying the correct call
// (S3), both still produced exactly one hit and stayed green. Now every
// matched `*.Content` element contributes EXACTLY ONE `hits` entry — its
// `onInteractOutside` initializer's printed text if the attribute is there,
// or the literal placeholder `"<no onInteractOutside>"` if it is not — so an
// element can no longer hide by omitting the attribute, and the test requires
// there be EXACTLY ONE element, whose entry is EXACTLY a call to
// `interactOutsideExemptingToaster` with the sole argument `onInteractOutside`
// — printed back out (comments stripped) and compared to that literal text.
function contentOnInteractOutsideTexts(file: string, functionName: string): string[] {
  const filePath = path.join(here, file);
  const src = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const printer = ts.createPrinter({ removeComments: true });

  let scope: ts.Node | undefined;
  function findScope(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      scope = node;
      return;
    }
    ts.forEachChild(node, findScope);
  }
  findScope(sourceFile);

  const hits: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningLikeElement(node) && /\.Content$/.test(node.tagName.getText(sourceFile))) {
      const attr = node.attributes.properties.find(
        (prop): prop is ts.JsxAttribute =>
          ts.isJsxAttribute(prop) && prop.name.getText(sourceFile) === "onInteractOutside"
      );
      const expr =
        attr?.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : undefined;
      hits.push(expr ? printer.printNode(ts.EmitHint.Unspecified, expr, sourceFile) : "<no onInteractOutside>");
    }
    ts.forEachChild(node, visit);
  }
  // scope undefined (the named function is gone or renamed) leaves hits
  // empty, which fails the exactly-one check below just as a missing
  // attribute would — this fails closed either way.
  if (scope) visit(scope);
  return hits;
}

describe("both SheetContent and DialogContent are wired to the shared factory, read from the AST", () => {
  it.each([
    ["sheet.tsx", "SheetContent"],
    ["dialog.tsx", "DialogContent"],
  ])(
    "%s's %s passes onInteractOutside={interactOutsideExemptingToaster(onInteractOutside)} exactly, and only once (mutation: a raw prop, a comment-only fake, a discarded call, or a correctly-wired decoy elsewhere in the file → FAILS)",
    (file, functionName) => {
      expect(contentOnInteractOutsideTexts(file, functionName)).toEqual([
        "interactOutsideExemptingToaster(onInteractOutside)",
      ]);
    }
  );
});
