import { describe, it, expect, vi, beforeEach } from "vitest";
import { PublicHtml } from "@/components/public/public-html";

// next/font/google throws outside a Next build (app/f/[publicId]/layout.test.ts).
vi.mock("next/font/google", () => ({ Geist: (o: unknown) => o, Inter: (o: unknown) => o, Source_Serif_4: (o: unknown) => o }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), serviceDb: () => ({ tag: "service" }) }));
const cp = vi.hoisted(() => ({ customerPage: vi.fn() }));
vi.mock("@/lib/document-requests/customer-upload", () => cp);

import CustomerDocsLayout, { metadata } from "./layout";
import { loadPageSafe } from "./data";

const SENTINEL = "__children__";
const PAGE = { state: "open", language: "es", business: "Casa Verde", logoUrl: null, branding: null, phone: null, items: [] };
const render = (token: string) => CustomerDocsLayout({ params: Promise.resolve({ token }), children: SENTINEL });

beforeEach(() => {
  cp.customerPage.mockReset().mockResolvedValue(PAGE);
});

describe("/d/[token] layout (plan review I8): the shell always stands", () => {
  it("<html lang> is the REQUEST's language, read through the same loader the page uses (mutation: hard-code en → FAILS)", async () => {
    const el = await render("tok");
    expect(el.type).toBe(PublicHtml);
    expect(el.props.lang).toBe("es");
    expect(el.props.children).toBe(SENTINEL);
    expect(cp.customerPage).toHaveBeenCalledWith({ tag: "service" }, "tok", expect.any(Date));
  });

  it("a failed read never throws here: the shell renders in English around the page's own error boundary (mutation: await the throwing loader → FAILS)", async () => {
    cp.customerPage.mockRejectedValue(new Error("db down"));
    const el = await render("tok");
    expect(el.type).toBe(PublicHtml);
    expect(el.props.lang).toBe("en");
    expect(el.props.children).toBe(SENTINEL);
  });

  it("loadPageSafe answers null on a rejected read, and the page itself on a good one", async () => {
    cp.customerPage.mockRejectedValueOnce(new Error("db down"));
    expect(await loadPageSafe("tok")).toBeNull();
    expect(await loadPageSafe("tok")).toEqual(PAGE);
  });

  it("carries the favicon (app/ declares none; the page sets its own title)", () => {
    expect(metadata.icons).toEqual({ icon: "/favicon.ico" });
  });
});
