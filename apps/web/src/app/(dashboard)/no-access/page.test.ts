import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

// /no-access?reason=off is reached by a client whose account's access is
// switched off AND by one whose access was never turned on (an adopted
// half-created company starts off, review of D-087). Its copy has to be true
// for both, and stay distinct from reason=none (the invitation case, D-001).

vi.mock("@clerk/nextjs", () => ({
  SignOutButton: ({ children }: { children: ReactNode }) => createElement("span", null, children),
}));
vi.mock("@/components/auth-shell", () => ({
  AuthShell: ({ children }: { children: ReactNode }) => createElement("main", null, children),
}));

const { default: NoAccess } = await import("./page");
const text = async (reason?: string) =>
  renderedText(renderToStaticMarkup(await NoAccess({ searchParams: Promise.resolve({ reason }) })));

describe("/no-access", () => {
  it("reason=off says access isn't turned on, true whether it was switched off or never on (mutation: restore 'has been turned off' → FAILS)", async () => {
    const off = await text("off");
    expect(off).toContain(m["clientAccess.off.title"]);
    expect(off).toContain(m["clientAccess.off.body"]);
    expect(off).not.toMatch(/has been turned off/i);
    expect(off).toMatch(/isn.t turned on/i);
  });

  it("reason=none keeps its own copy, apart from off (D-001's distinction)", async () => {
    const none = await text("none");
    expect(none).toContain(m["clientAccess.none.title"]);
    expect(none).not.toContain(m["clientAccess.off.title"]);
  });
});
