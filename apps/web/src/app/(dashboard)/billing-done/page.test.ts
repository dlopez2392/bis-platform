import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

const h = vi.hoisted(() => ({ acceptLanguage: null as string | null }));

vi.mock("@/components/auth-shell", () => ({ AuthShell: ({ children }: { children: ReactNode }) => createElement("main", null, children) }));
// S-10 T7 (spec §7 Q5): signed-out, part of the same family — browser language only.
vi.mock("next/headers", () => ({
  headers: async () => new Headers(h.acceptLanguage ? { "accept-language": h.acceptLanguage } : {}),
}));
const { default: BillingDone } = await import("./page");
const html = async (result?: string) => renderToStaticMarkup(await BillingDone({ searchParams: Promise.resolve({ result }) }));

beforeEach(() => {
  h.acceptLanguage = null;
});

describe("/billing-done (G17)", () => {
  it("after checkout says the plan starts once the payment is confirmed and the tab can close, never that it IS active: only the webhook knows that (mutation: show the cancelled copy on success → FAILS; say the plan is active → FAILS)", async () => {
    const text = renderedText(await html("success"));
    expect(text).toContain(m["billing.done.success.title"]);
    expect(text).toContain(m["billing.done.success.body"]);
    expect(text).not.toMatch(/\bactive\b/i);
  });

  it("anything else (cancelled, or no result) says nothing was charged: the page never claims a payment it cannot know (mutation: default to the success copy → FAILS)", async () => {
    for (const r of ["cancelled", undefined, "bogus"]) {
      const text = renderedText(await html(r));
      expect(text).toContain(m["billing.done.cancelled.body"]);
      expect(text).not.toContain(m["billing.done.success.title"]);
    }
  });

  it("a Spanish-ranked Accept-Language renders in Spanish (mutation: read m[...] directly → FAILS)", async () => {
    h.acceptLanguage = "es-MX,en;q=0.5";
    const text = renderedText(await html("success"));
    expect(text).toContain(m["billing.done.success.title.es"]);
    expect(text).toContain(m["billing.done.success.body.es"]);
  });
});
