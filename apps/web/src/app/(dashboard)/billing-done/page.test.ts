import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

vi.mock("@/components/auth-shell", () => ({ AuthShell: ({ children }: { children: ReactNode }) => createElement("main", null, children) }));
const { default: BillingDone } = await import("./page");
const html = async (result?: string) => renderToStaticMarkup(await BillingDone({ searchParams: Promise.resolve({ result }) }));

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
});
