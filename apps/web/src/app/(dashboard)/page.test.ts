import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

// D-001. The landing page at "/" is where a signed-in visitor with no agency
// role lands. A client whose company's access was switched OFF was told to
// "open the invitation link from your email" — advice that cannot help, for a
// state the client did not cause. The access state is mocked at the
// resolver seam both helpers share, so the page cannot dodge the test by
// calling one helper instead of the other.

type State =
  | { status: "agency" }
  | { status: "ok"; id: string; name: string; timezone: string }
  | { status: "off" }
  | { status: "none" };

const h = vi.hoisted(() => ({
  state: { status: "none" } as State,
  claims: {} as Record<string, string>,
  userId: "user_1" as string | null,
  acceptLanguage: null as string | null,
}));

class Redirect extends Error {
  constructor(public readonly to: string) {
    super(`NEXT_REDIRECT ${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(h.acceptLanguage ? { "accept-language": h.acceptLanguage } : {}),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: h.userId, sessionClaims: h.claims }),
}));
vi.mock("@clerk/nextjs", () => ({
  SignOutButton: ({ children }: { children: ReactNode }) => createElement("span", null, children),
}));
vi.mock("@/components/auth-shell", () => ({
  AuthShell: ({ children }: { children: ReactNode }) => createElement("main", null, children),
}));
vi.mock("@/lib/auth", () => ({
  resolveClientAccessState: async () => h.state,
  resolveClientAccount: async () =>
    h.state.status === "ok" ? { id: h.state.id, name: h.state.name } : null,
}));

const { default: Home } = await import("./page");

async function visit(): Promise<{ redirectedTo: string } | { text: string }> {
  try {
    return { text: renderedText(renderToStaticMarkup(await Home())) };
  } catch (e) {
    if (e instanceof Redirect) return { redirectedTo: e.to };
    throw e;
  }
}

beforeEach(() => {
  h.userId = "user_1";
  h.claims = {};
  h.state = { status: "none" };
  h.acceptLanguage = null;
});

describe("/ (landing) for a signed-in client (D-001)", () => {
  it("a client whose access is switched off is sent to the 'access isn't turned on' page, never told to open their invitation (mutation: drop the off branch → FAILS)", async () => {
    h.claims = { org_id: "org_off" };
    h.state = { status: "off" };
    const result = await visit();
    expect(result).toEqual({ redirectedTo: "/no-access?reason=off" });
  });

  it("a client with access on still lands in their own account", async () => {
    h.claims = { org_id: "org_ok" };
    h.state = { status: "ok", id: "acc_1", name: "Rio", timezone: "America/Chicago" };
    expect(await visit()).toEqual({ redirectedTo: "/dashboard/accounts/acc_1/dashboard" });
  });

  it("a sign-in tied to no company at all still gets the invitation advice — that copy is right for exactly this visitor", async () => {
    h.state = { status: "none" };
    const result = await visit();
    expect("text" in result && result.text).toContain(m["landing.noAccess.body"]);
  });

  // S-10 T7 (spec §7 Q5): "/" is part of the signed-out family — no stored
  // preference exists here, only the browser's own Accept-Language.
  it("a Spanish-ranked Accept-Language renders the invitation advice in Spanish (mutation: read m[...] directly → FAILS)", async () => {
    h.state = { status: "none" };
    h.acceptLanguage = "es-MX,en;q=0.5";
    const result = await visit();
    expect("text" in result && result.text).toContain(m["landing.noAccess.body.es"]);
  });
});
