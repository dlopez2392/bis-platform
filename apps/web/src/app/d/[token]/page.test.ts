import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { publicFormTheme } from "@/lib/branding/public-form-theme";
import type { Branding } from "@bis/db";
import type { CustomerPage } from "@/lib/document-requests/customer-upload";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const data = vi.hoisted(() => ({ loadPage: vi.fn(), loadPageSafe: vi.fn() }));
vi.mock("./data", () => data);

import CustomerDocsPage, { generateMetadata, dynamic } from "./page";

const BRANDING: Branding = {
  brandName: "Casa Verde", brandLogoPath: "acct/logo.png", brandColor: "#0e7490", brandNeutral: null,
  brandCorners: null, brandType: null, brandMode: "light", replyToEmail: null,
};
const LOGO = "https://cdn.example.test/brand/acct/logo.png";
const OPEN_ES: CustomerPage = {
  state: "open", language: "es", business: "Casa Verde", logoUrl: LOGO, branding: BRANDING, phone: "(956) 555-0123",
  items: [{ key: "id", label: "Identificación", files: [{ state: "received", ageMs: 1000 }] }, { key: "other", label: "Comprobante de domicilio", files: [] }],
};
const page = (o: Partial<CustomerPage>): CustomerPage => ({ ...OPEN_ES, ...o });
const NOT_FOUND: CustomerPage = { state: "not_found", language: "en", business: "the business", logoUrl: null, branding: null, phone: null, items: [] };

async function render(p: CustomerPage) {
  data.loadPage.mockResolvedValue(p);
  data.loadPageSafe.mockResolvedValue(p);
  const html = renderToStaticMarkup(await CustomerDocsPage({ params: Promise.resolve({ token: "tok" }) }));
  // What a reader reads: the page's <style> text is not copy.
  return { html, text: renderedText(html.replace(/<style>[\s\S]*?<\/style>/g, "")).replace(/\s+/g, " ") };
}

beforeEach(() => {
  data.loadPage.mockReset();
  data.loadPageSafe.mockReset();
});

describe("/d/[token] page", () => {
  it("is rendered on every request", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("an open Spanish request: lang-correct copy, the logo through PublicBrand, the tenant theme on <main>, the items with their controls, and 'Con tecnología de BIS' (rule 9)", async () => {
    expect(publicFormTheme(BRANDING, false).themed).toBe(true); // the fixture really is themed, so the attribute below can fail
    const { html, text } = await render(OPEN_ES);
    expect(html).toMatch(/<main class="bis-docreq-page" lang="es"/);
    expect(html).toMatch(/<main[^>]*data-tenant-theme=""/);
    expect(html).toContain(`--form-accent:${(publicFormTheme(BRANDING, false).style as Record<string, string>)["--form-accent"]}`);
    expect(html).toContain(`<img src="${LOGO}" alt="" class="bis-brand-logo"/>`);
    expect(html).toContain(`<span class="bis-brand-name">Casa Verde</span>`);
    expect(text).toContain("Casa Verde le pide estos documentos");
    expect(text).toContain("Suba cada uno abajo. Solo Casa Verde los verá.");
    expect(text).toContain("Identificación");
    expect(text).toContain("Comprobante de domicilio");
    expect(text).toContain("Recibido");
    expect(html.match(/type="file"/g)).toHaveLength(4);
    expect(text).toContain("¿Preguntas? Llame a Casa Verde al (956) 555-0123.");
    expect(html).toMatch(/<a href="https:\/\/bis-rgv\.com"[^>]*>Con tecnología de BIS<\/a>/);
    expect(text).not.toMatch(/Upload|Questions|Powered by/);
  });

  it("an open English request reads English", async () => {
    const { html, text } = await render(page({ language: "en", items: [{ key: "id", label: "ID", files: [] }] }));
    expect(html).toMatch(/<main class="bis-docreq-page" lang="en"/);
    expect(text).toContain("Casa Verde asks for these documents");
    expect(text).toContain("Upload each one below. Only Casa Verde will see them.");
    expect(text).toContain("Questions? Call Casa Verde at (956) 555-0123.");
    expect(text).toContain("Powered by BIS");
  });

  it("expired (Spanish): its sentence, the ask, and the call line with the phone, and no upload control", async () => {
    const { html, text } = await render(page({ state: "expired" }));
    expect(text).toContain("Este enlace venció.");
    expect(text).toContain("Pida a Casa Verde un enlace nuevo.");
    expect(text).toContain("¿Preguntas? Llame a Casa Verde al (956) 555-0123.");
    expect(html).not.toContain('type="file"');
  });

  it("revoked: its own sentence and the ask", async () => {
    const { text } = await render(page({ state: "revoked", language: "en" }));
    expect(text).toContain("This link is no longer active.");
    expect(text).toContain("Ask Casa Verde for a new link.");
    expect(text).toContain("Questions? Call Casa Verde at (956) 555-0123.");
  });

  it("not_found: its own sentence, the ask, NO call line and no brand (nothing about any business is known)", async () => {
    const { html, text } = await render(NOT_FOUND);
    expect(text).toContain("This link doesn't work.");
    expect(text).toContain("Ask the business for a new link.");
    expect(text).not.toContain("Questions?");
    expect(html).not.toContain("bis-brand");
    expect(html).not.toContain("data-tenant-theme");
    expect(text).toContain("Powered by BIS");
  });

  it("completed: the thank-you and the call line", async () => {
    const { text } = await render(page({ state: "completed", language: "en" }));
    expect(text).toContain("Thank you. Casa Verde has everything it asked for.");
    expect(text).toContain("Questions? Call Casa Verde at (956) 555-0123.");
  });

  it.each(["expired", "revoked", "completed", "not_found"] as const)("%s renders no upload control: only an open request takes files (mutation: render the list for an expired request → FAILS)", async (state) => {
    const { html, text } = await render(page({ state }));
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("data-docreq-item");
    expect(text).not.toContain("Subir");
    expect(text).not.toContain("Identificación");
  });

  it("no live number: the call line without a phone", async () => {
    const { text } = await render(page({ phone: null, language: "en" }));
    expect(text).toContain("Questions? Contact Casa Verde.");
    expect(text).not.toContain("{");
  });

  it("an account with no brand name: the brand header shows no 'the business', and a sentence that OPENS with it is capitalised", async () => {
    const unnamed = page({ business: "el negocio", branding: { ...BRANDING, brandName: null }, logoUrl: null });
    const es = await render(unnamed);
    expect(es.html).not.toContain("bis-brand-name");
    expect(es.text).toContain("El negocio le pide estos documentos");
    expect(es.text).toContain("Solo el negocio los verá.");
    const done = await render({ ...unnamed, state: "completed", language: "en", business: "the business" });
    expect(done.text).toContain("Thank you. The business has everything it asked for.");
    expect(done.text).toContain("Questions? Call the business at (956) 555-0123.");
  });

  it("a brand name is never re-cased: 'eBay Movers' stays as the business wrote it", async () => {
    const { text } = await render(page({ business: "eBay Movers", branding: { ...BRANDING, brandName: "eBay Movers" }, language: "en" }));
    expect(text).toContain("eBay Movers asks for these documents");
  });

  it("a failed read throws to the page's error boundary rather than inventing a state", async () => {
    data.loadPage.mockRejectedValue(new Error("db down"));
    await expect(CustomerDocsPage({ params: Promise.resolve({ token: "tok" }) })).rejects.toThrow("db down");
  });

  it("generateMetadata: never indexed, no Referer to the logo's host, the title in the request's language", async () => {
    data.loadPageSafe.mockResolvedValue(OPEN_ES);
    expect(await generateMetadata({ params: Promise.resolve({ token: "tok" }) })).toEqual({
      title: "Enviar documentos", robots: { index: false, follow: false }, referrer: "no-referrer",
    });
    data.loadPageSafe.mockResolvedValue(null);
    expect((await generateMetadata({ params: Promise.resolve({ token: "tok" }) })).title).toBe("Send documents");
  });
});
