import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
// wires it in. Reading the source (the same technique button.test.ts uses)
// closes that gap — wiring only one of the two primitives to the shared
// factory must fail one of these.
describe("both SheetContent and DialogContent are wired to the shared factory", () => {
  it.each([
    ["sheet.tsx", "SheetContent"],
    ["dialog.tsx", "DialogContent"],
  ])("%s's %s composes onInteractOutside through interactOutsideExemptingToaster", (file) => {
    const src = readFileSync(path.join(here, file), "utf8");
    expect(src).toContain("interactOutsideExemptingToaster(");
  });
});
