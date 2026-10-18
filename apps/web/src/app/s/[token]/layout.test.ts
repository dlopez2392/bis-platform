import { describe, it, expect, vi, beforeEach } from "vitest";
import { PublicHtml } from "@/components/public/public-html";

// next/font/google throws outside a Next build (app/f/[publicId]/layout.test.ts).
vi.mock("next/font/google", () => ({ Geist: (o: unknown) => o, Inter: (o: unknown) => o, Source_Serif_4: (o: unknown) => o }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), serviceDb: () => ({ tag: "service" }) }));
const ps = vi.hoisted(() => ({ sharePage: vi.fn() }));
vi.mock("@/lib/document-shares/public-share", () => ps);

import SharedFileLayout, { metadata } from "./layout";
import { loadPageSafe } from "./data";

const SENTINEL = "__children__";
const PAGE = { state: "open", language: "es", branding: null, logoUrl: null, phone: null, file: { title: "Seguro", type: "PDF", size: "12 KB" } };
const render = (token: string) => SharedFileLayout({ params: Promise.resolve({ token }), children: SENTINEL });

beforeEach(() => {
  ps.sharePage.mockReset().mockResolvedValue(PAGE);
});

describe("/s/[token] layout: the shell always stands", () => {
  it("<html lang> is the ACCOUNT's language, read through the same loader the page uses (mutation: hard-code en → FAILS)", async () => {
    const el = await render("tok");
    expect(el.type).toBe(PublicHtml);
    expect(el.props.lang).toBe("es");
    expect(el.props.children).toBe(SENTINEL);
    expect(ps.sharePage).toHaveBeenCalledWith({ tag: "service" }, "tok", expect.any(Date));
  });

  it("a failed read never throws here: the shell renders in English around the page's own error boundary (mutation: await the throwing loader → FAILS)", async () => {
    ps.sharePage.mockRejectedValue(new Error("db down"));
    const el = await render("tok");
    expect(el.type).toBe(PublicHtml);
    expect(el.props.lang).toBe("en");
    expect(el.props.children).toBe(SENTINEL);
  });

  it("loadPageSafe answers null on a rejected read, and the page itself on a good one", async () => {
    ps.sharePage.mockRejectedValueOnce(new Error("db down"));
    expect(await loadPageSafe("tok")).toBeNull();
    expect(await loadPageSafe("tok")).toEqual(PAGE);
  });

  it("carries the favicon (app/ declares none; the page sets its own title)", () => {
    expect(metadata.icons).toEqual({ icon: "/favicon.ico" });
  });
});
