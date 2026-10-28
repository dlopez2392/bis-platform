// apps/web/src/components/ui/dialog.test.ts
//
// The dialog's two built-in "Close" names, rendered rather than read from
// source. Radix's Portal renders nothing on the server (it waits for a
// mounted document.body), so this one file swaps it for a pass-through; every
// other part of the real Dialog renders as it does in the app.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("radix-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("radix-ui")>();
  return {
    ...actual,
    Dialog: { ...actual.Dialog, Portal: ({ children }: { children?: React.ReactNode }) => children },
  };
});

const { Dialog, DialogContent, DialogFooter, DialogTitle, DialogDescription } = await import("./dialog");

const open = (...children: React.ReactNode[]) =>
  renderToStaticMarkup(createElement(Dialog, { open: true }, ...children));

const content = (props: Record<string, unknown> = {}) =>
  open(createElement(DialogContent, props,
    createElement(DialogTitle, null, "T"), createElement(DialogDescription, null, "D")));

const srOnly = (html: string) =>
  [...html.matchAll(/<span class="sr-only">([^<]*)<\/span>/g)].map((x) => x[1]);

describe("DialogContent's close (X) button name", () => {
  it("defaults to Close, so a caller that passes nothing is unchanged (mutation: drop the default -> FAILS)", () => {
    expect(srOnly(content())).toEqual(["Close"]);
  });

  it("is the closeLabel prop when one is passed, e.g. Spanish (mutation: keep the literal Close -> FAILS)", () => {
    expect(srOnly(content({ closeLabel: "Cerrar" }))).toEqual(["Cerrar"]);
  });
});

describe("DialogFooter's built-in Close button (2026-10-28)", () => {
  const footerButton = (props: Record<string, unknown>) => {
    const html = open(createElement(DialogFooter, { showCloseButton: true, ...props }));
    const m = html.match(/<button[^>]*>([^<]*)<\/button>/);
    expect(m, html).not.toBeNull();
    return m![1];
  };

  it("reads Close by default (mutation: drop the default -> FAILS)", () => {
    expect(footerButton({})).toBe("Close");
  });

  it("reads the closeLabel prop when passed, e.g. Cerrar on a Spanish dialog (mutation: keep the literal Close -> FAILS)", () => {
    expect(footerButton({ closeLabel: "Cerrar" })).toBe("Cerrar");
  });
});
