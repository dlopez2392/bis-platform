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
// ever exists, so they cannot satisfy this. On the `*.Content` JSX element,
// the `onInteractOutside` attribute's initializer must be EXACTLY a call to
// `interactOutsideExemptingToaster` whose sole argument is the identifier
// `onInteractOutside` — printed back out (comments stripped, so a fake
// alongside the real prop can't leak in) and compared to that literal text.
function onInteractOutsideInitializerText(file: string): string | undefined {
  const filePath = path.join(here, file);
  const src = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningLikeElement(node) && /\.Content$/.test(node.tagName.getText(sourceFile))) {
      for (const prop of node.attributes.properties) {
        if (
          ts.isJsxAttribute(prop) &&
          prop.name.getText(sourceFile) === "onInteractOutside" &&
          prop.initializer &&
          ts.isJsxExpression(prop.initializer) &&
          prop.initializer.expression
        ) {
          found = prop.initializer.expression;
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (!found) return undefined;
  return ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, found, sourceFile);
}

describe("both SheetContent and DialogContent are wired to the shared factory, read from the AST", () => {
  it.each([
    ["sheet.tsx", "SheetContent"],
    ["dialog.tsx", "DialogContent"],
  ])(
    "%s's %s passes onInteractOutside={interactOutsideExemptingToaster(onInteractOutside)} exactly (mutation: a raw prop, a comment-only fake, or a discarded call → FAILS)",
    (file) => {
      expect(onInteractOutsideInitializerText(file)).toBe("interactOutsideExemptingToaster(onInteractOutside)");
    }
  );
});
