import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { publicFormTheme } from "@/lib/branding/public-form-theme";
import type { Branding } from "@bis/db";
import type { SharePage, ShareState } from "@/lib/document-shares/public-share";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const data = vi.hoisted(() => ({ loadPage: vi.fn(), loadPageSafe: vi.fn() }));
vi.mock("./data", () => data);

import SharedFilePage, { generateMetadata, dynamic } from "./page";

const BRANDING: Branding = {
  brandName: "Casa Verde", brandLogoPath: "acct/logo.png", brandColor: "#0e7490", brandNeutral: null,
  brandCorners: null, brandType: null, brandMode: "light", replyToEmail: null,
};
const LOGO = "https://cdn.example.test/brand/acct/logo.png";
const TITLE = "Seguro 2026";
const TOKEN = "Zk3pQ9vT2mW8xR4nL6bY1cH5sJ7dF0gA2eU9iO3kP8q";
const OPEN_ES: SharePage = {
  state: "open", language: "es", branding: BRANDING, logoUrl: LOGO, phone: "(956) 555-0123",
  file: { title: TITLE, type: "PDF", size: "1.2 MB" },
};
const page = (o: Partial<SharePage>): SharePage => ({ ...OPEN_ES, ...o });
/** public-share.ts's NOT_FOUND_PAGE, exactly. */
const NOT_FOUND: SharePage = { state: "not_found", language: "en", branding: null, logoUrl: null, phone: null, file: null };

async function render(p: SharePage) {
  data.loadPage.mockResolvedValue(p);
  data.loadPageSafe.mockResolvedValue(p);
  const html = renderToStaticMarkup(await SharedFilePage({ params: Promise.resolve({ token: TOKEN }) }));
  // The markup outside the <style>s: a class named in a stylesheet is not an element, and style text is not copy.
  const markup = html.replace(/<style>[\s\S]*?<\/style>/g, "");
  return { html: markup, text: renderedText(markup).replace(/\s+/g, " ") };
}
/** The page's sentences, in order: the heading, the details or the ask, and the call line (an empty note region is not a sentence). */
const sentencesOf = (html: string) => [...html.matchAll(/<(h1|p)[^>]*class="bis-docreq-(?:title|detail|call)"[^>]*>(.*?)<\/\1>/g)]
  .map((x) => renderedText(x[2]!).trim()).filter((s) => s !== "");

beforeEach(() => {
  data.loadPage.mockReset();
  data.loadPageSafe.mockReset();
});

describe("/s/[token] page", () => {
  it("is rendered on every request (Cache-Control: no-store, plan deviation 7)", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("an open Spanish link: the account's language, the tenant theme, the logo, the heading, the title, its type and size, ONE Download, the call line and 'Con tecnología de BIS' (rule 9)", async () => {
    expect(publicFormTheme(BRANDING, false).themed).toBe(true); // the fixture really is themed, so the attribute below can fail
    const { html, text } = await render(OPEN_ES);
    expect(html).toMatch(/<main class="bis-docreq-page" lang="es"/);
    expect(html).toMatch(/<main[^>]*data-tenant-theme=""/);
    expect(html).toContain(`--form-accent:${(publicFormTheme(BRANDING, false).style as Record<string, string>)["--form-accent"]}`);
    expect(html).toContain(`<img src="${LOGO}" alt="" class="bis-brand-logo"/>`);
    expect(html).toContain(`<span class="bis-brand-name">Casa Verde</span>`);
    expect(html).toContain(`<h1 class="bis-docreq-title" data-share-state="open">Casa Verde compartió un archivo con usted</h1>`);
    expect(html).toContain(`<p class="bis-docreq-label" lang="">${TITLE}</p>`);
    expect(sentencesOf(html)).toEqual(["Casa Verde compartió un archivo con usted", "Archivo PDF · 1.2 MB", "¿Preguntas? Llame a Casa Verde al (956) 555-0123."]);
    expect(html.match(/data-share-download/g)).toHaveLength(1);
    expect(html.match(/class="bis-docreq-primary"/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*data-share-download="true"[^>]*>Descargar<\/button>/);
    expect(html).toMatch(/<a href="https:\/\/bis-rgv\.com"[^>]*>Con tecnología de BIS<\/a>/);
    expect(text).not.toMatch(/Download|Questions|Powered by|shared a file/);
    expect(html).not.toContain("data-hero");
    // Not in the static HTML. renderToStaticMarkup cannot see a client component's props, though: the token
    // IS serialized into the page data for ShareDownload's fetch, so it reaches the browser. That residual is
    // accepted (final review minor 5): the token is already in the address bar, the same exposure.
    expect(html).not.toContain(TOKEN);
  });

  it("an open English link reads English", async () => {
    const { html, text } = await render(page({ language: "en" }));
    expect(html).toMatch(/<main class="bis-docreq-page" lang="en"/);
    expect(sentencesOf(html)).toEqual(["Casa Verde shared a file with you", "PDF file · 1.2 MB", "Questions? Call Casa Verde at (956) 555-0123."]);
    expect(html).toMatch(/<button[^>]*data-share-download="true"[^>]*>Download<\/button>/);
    expect(text).toContain("Powered by BIS");
  });

  it.each<[Exclude<ShareState, "open" | "not_found">, string]>([
    ["expired", "This link has expired."],
    ["revoked", "This link was turned off."],
    ["trashed", "This file isn't available any more."],
    ["removed", "This file was removed for safety."],
  ])("%s: its own sentence, the ask naming the business, the call line, NO Download and NO file title, even if the read carried one (mutation: render the title on a refusal → FAILS)", async (state, sentence) => {
    const { html, text } = await render(page({ state, language: "en" }));
    expect(html).toContain(`<h1 class="bis-docreq-title" data-share-state="${state}">`);
    expect(sentencesOf(html)).toEqual([sentence, "Ask Casa Verde to send it again.", "Questions? Call Casa Verde at (956) 555-0123."]);
    expect(html).not.toContain("data-share-download");
    expect(html).not.toContain("bis-docreq-primary");
    expect(html).not.toContain("bis-docreq-label");
    expect(text).not.toContain(TITLE);
    expect(text).not.toContain("1.2 MB");
    expect(html).toContain(`<span class="bis-brand-name">Casa Verde</span>`);
    expect(text).toContain("Powered by BIS");
  });

  it("a refusal in Spanish reads Spanish", async () => {
    const { html } = await render(page({ state: "revoked" }));
    expect(sentencesOf(html)).toEqual(["Este enlace se desactivó.", "Pida a Casa Verde que se lo envíe de nuevo.", "¿Preguntas? Llame a Casa Verde al (956) 555-0123."]);
  });

  it("an open state with no file read is never shown as open: it reads as not found", async () => {
    const { html } = await render(page({ file: null, language: "en" }));
    expect(html).not.toContain("data-share-download");
    expect(sentencesOf(html)[0]).toBe("This link doesn't work.");
  });

  it("no live number: the call line without a phone", async () => {
    const { text } = await render(page({ phone: null, language: "en" }));
    expect(text).toContain("Questions? Contact Casa Verde.");
    expect(text).not.toContain("{");
  });

  it("not_found: its own sentence and NOTHING about any business: no ask, no call line, no brand, no theme", async () => {
    const { html, text } = await render(NOT_FOUND);
    expect(sentencesOf(html)).toEqual(["This link doesn't work."]);
    expect(text).not.toContain("Questions?");
    expect(text).not.toContain("Ask ");
    expect(html).not.toContain("bis-brand");
    expect(html).not.toContain("data-tenant-theme");
    expect(html).not.toContain("data-share-download");
    expect(text).toContain("Powered by BIS");
  });

  it("not_found names no business even if a read handed one over (mutation: drop the page's not_found guard → FAILS)", async () => {
    const { html, text } = await render({ ...OPEN_ES, state: "not_found", language: "en" });
    expect(sentencesOf(html)).toEqual(["This link doesn't work."]);
    expect(text).not.toContain("Casa Verde");
    expect(text).not.toContain("555-0123");
    expect(text).not.toContain(TITLE);
    expect(html).not.toContain(LOGO);
    expect(html).not.toContain("data-tenant-theme");
  });

  // With no brand name, every sentence that would name the business is its own sentence (copy.ts).
  const NO_NAME: Record<ShareState, Record<"en" | "es", string[]>> = {
    open: {
      en: ["A file was shared with you", "PDF file · 1.2 MB", "Questions? Call the business at (956) 555-0123."],
      es: ["Se compartió un archivo con usted", "Archivo PDF · 1.2 MB", "¿Preguntas? Llame al negocio al (956) 555-0123."],
    },
    expired: {
      en: ["This link has expired.", "Ask the business that sent it to send it again.", "Questions? Call the business at (956) 555-0123."],
      es: ["Este enlace venció.", "Pida al negocio que se lo envió que lo mande de nuevo.", "¿Preguntas? Llame al negocio al (956) 555-0123."],
    },
    revoked: {
      en: ["This link was turned off.", "Ask the business that sent it to send it again.", "Questions? Call the business at (956) 555-0123."],
      es: ["Este enlace se desactivó.", "Pida al negocio que se lo envió que lo mande de nuevo.", "¿Preguntas? Llame al negocio al (956) 555-0123."],
    },
    trashed: {
      en: ["This file isn't available any more.", "Ask the business that sent it to send it again.", "Questions? Call the business at (956) 555-0123."],
      es: ["Este archivo ya no está disponible.", "Pida al negocio que se lo envió que lo mande de nuevo.", "¿Preguntas? Llame al negocio al (956) 555-0123."],
    },
    removed: {
      en: ["This file was removed for safety.", "Ask the business that sent it to send it again.", "Questions? Call the business at (956) 555-0123."],
      es: ["Este archivo se quitó por seguridad.", "Pida al negocio que se lo envió que lo mande de nuevo.", "¿Preguntas? Llame al negocio al (956) 555-0123."],
    },
    not_found: { en: ["This link doesn't work."], es: ["Este enlace no funciona."] },
  };
  it.each((Object.keys(NO_NAME) as ShareState[]).flatMap((state) => (["en", "es"] as const).map((lang) => [state, lang] as const)))(
    "no brand name, %s (%s): each sentence is its own no-name wording, never {business}, 'the business shared' or 'a el'",
    async (state, lang) => {
      const { html, text } = await render(page({ state, language: lang, branding: { ...BRANDING, brandName: null }, logoUrl: null }));
      expect(sentencesOf(html)).toEqual(NO_NAME[state][lang]);
      expect(text).not.toContain("{");
      expect(text).not.toMatch(/the business shared|el negocio compartió|\b(a|de) el\b/i);
      expect(html).not.toContain("bis-brand-name");
    },
  );

  it("no brand name and no live number: the call line without a phone, in Spanish", async () => {
    const { text } = await render(page({ state: "expired", phone: null, branding: null, logoUrl: null }));
    expect(text).toContain("¿Preguntas? Comuníquese con el negocio.");
  });

  it("a failed read throws to the page's error boundary rather than inventing a state", async () => {
    data.loadPage.mockRejectedValue(new Error("db down"));
    await expect(SharedFilePage({ params: Promise.resolve({ token: TOKEN }) })).rejects.toThrow("db down");
  });

  it("generateMetadata: never indexed, no Referer, the title in the account's language and naming the business", async () => {
    data.loadPageSafe.mockResolvedValue(OPEN_ES);
    expect(await generateMetadata({ params: Promise.resolve({ token: TOKEN }) })).toEqual({
      title: "Un archivo de Casa Verde", robots: { index: false, follow: false }, referrer: "no-referrer",
    });
    data.loadPageSafe.mockResolvedValue(page({ language: "en", branding: null }));
    expect((await generateMetadata({ params: Promise.resolve({ token: TOKEN }) })).title).toBe("A shared file");
    data.loadPageSafe.mockResolvedValue(null);
    expect((await generateMetadata({ params: Promise.resolve({ token: TOKEN }) })).title).toBe("A shared file");
  });

  it("generateMetadata for an unknown token names no business, even if a read handed one over", async () => {
    data.loadPageSafe.mockResolvedValue({ ...OPEN_ES, state: "not_found", language: "en" });
    expect((await generateMetadata({ params: Promise.resolve({ token: TOKEN }) })).title).toBe("A shared file");
  });
});
