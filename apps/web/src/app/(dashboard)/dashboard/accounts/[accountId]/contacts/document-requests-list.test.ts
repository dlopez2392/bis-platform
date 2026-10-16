import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");
const { DocumentRequestsList } = await import("./document-requests-list");
type Props = Parameters<typeof DocumentRequestsList>[0];
type Load = Props["load"];

const NOW = "2026-10-15T15:00:00.000Z";
const request = (over: Record<string, unknown> = {}) => ({
  id: "r1", channel: "text", createdAt: "2026-10-14T15:00:00.000Z", expiresAt: "2026-10-21T15:00:00.000Z",
  items: [
    { key: "insurance", category: "insurance", note: null, answered: true },
    { key: "other", category: "other", note: "Pool permit", answered: false },
  ],
  ...over,
});
const ready = (requests: unknown[]): Load => ({ kind: "ready", data: { now: NOW, channels: { text: true, email: true }, requests } } as Load);
const render = (load: Load, over: Partial<Props> = {}) => renderToStaticMarkup(createElement(DocumentRequestsList, {
  locale: "en", load, onRetry: vi.fn(), onCopy: vi.fn(), onRevoke: vi.fn(), ...over,
} as Props));
const words = (html: string) => renderedText(html).replace(/\s+/g, " ");
/** One item's own markup. */
const itemOf = (html: string, key: string) => {
  const at = html.indexOf(`data-request-item="${key}"`);
  return html.slice(html.lastIndexOf("<li", at), html.indexOf("</li>", at));
};

describe("the open requests on the Documents card (spec 4.2, 6)", () => {
  it("a ready request: the label, each item as a dot AND a word, the days left, ghost Copy link and Revoke (rule 3; mutation: drop the word -> FAILS)", () => {
    const html = render(ready([request()]));
    const text = words(html);
    expect(text).toContain("Asked for");
    expect(words(itemOf(html, "insurance"))).toContain("Insurance · Received");
    expect(itemOf(html, "insurance")).toContain("bg-[var(--good)]");
    expect(words(itemOf(html, "other"))).toContain("Pool permit · Waiting");
    expect(itemOf(html, "other")).toContain("bg-[var(--warn)]");
    expect(itemOf(html, "other")).not.toContain("bg-[var(--good)]");
    // The dot is decoration; the word carries the state.
    expect(itemOf(html, "insurance")).toMatch(/<span aria-hidden="true"[^>]*bg-\[var\(--good\)\]/);
    expect(text).toContain("expires in 6 days");
    expect(html).toMatch(/data-variant="ghost"[^>]*>Copy link</);
    expect(html).toMatch(/data-variant="ghost"[^>]*>Revoke</);
  });

  it("the list draws no primary at all (rule 8: the card's Upload stays its one; mutation: Revoke as a primary -> FAILS)", () => {
    expect(render(ready([request(), request({ id: "r2" })]))).not.toContain('data-variant="default"');
  });

  it("the Label role: mono, 10px, +0.14em, uppercase", () => {
    const label = /<h3[^>]*>Asked for</.exec(render(ready([request()])))![0];
    for (const c of ["font-mono", "text-[10px]", "font-medium", "uppercase", "tracking-[0.14em]"]) expect(label).toContain(c);
  });

  it("each row's Copy link and Revoke are described by THAT row's items, so two rows' buttons are told apart (review M8; mutation: drop aria-describedby -> FAILS)", () => {
    const html = render(ready([request(), request({ id: "r2", items: [{ key: "id", category: "id", note: null, answered: false }] })]));
    for (const id of ["r1", "r2"]) {
      const at = html.indexOf(`data-document-request="${id}"`);
      const next = html.indexOf("data-document-request=", at + 1);
      const row = html.slice(at, next === -1 ? undefined : next);
      const list = /<ul id="([^"]+)"/.exec(row)![1]!;
      const copy = /<button[^>]*data-request-copy[^>]*>/.exec(row)![0];
      const revoke = /<button[^>]*data-request-revoke[^>]*>/.exec(row)![0];
      expect(copy).toContain(`aria-describedby="${list}"`);
      expect(revoke).toContain(`aria-describedby="${list}"`);
    }
    const ids = [...html.matchAll(/<ul id="([^"]+)"/g)].map((x) => x[1]);
    expect(new Set(ids).size).toBe(2);
    // The describing list holds the items' words.
    const first = html.slice(html.indexOf(`<ul id="${ids[0]}"`));
    expect(words(first.slice(0, first.indexOf("</ul>")))).toContain("Insurance · Received");
  });

  it("each request's rows carry its id; one row per request", () => {
    const html = render(ready([request(), request({ id: "r2" })]));
    expect(html.match(/data-document-request="/g)).toHaveLength(2);
  });

  it("expires in 1 day (rounded up), and today at zero, in both languages (mutations: the base key through t() instead of plural -> FAILS; no today branch -> FAILS)", () => {
    const soon = ready([request({ expiresAt: "2026-10-15T16:00:00.000Z" })]);
    // Not a bare toContain: "expires in 1 days" contains "expires in 1 day" (the plural probe passed against it once).
    expect(words(render(soon))).toMatch(/expires in 1 day(?!s)/);
    expect(words(render(soon, { locale: "es" }))).toMatch(/vence en 1 día(?!s)/);
    const gone = ready([request({ expiresAt: NOW })]);
    expect(words(render(gone))).toContain("expires today");
    expect(words(render(gone, { locale: "es" }))).toContain("vence hoy");
  });

  it("Spanish: the label, Recibido and Pendiente as words, and the ghost buttons, compared with literals", () => {
    const html = render(ready([request()]), { locale: "es" });
    const text = words(html);
    expect(text).toContain("Pedido");
    expect(words(itemOf(html, "insurance"))).toContain("Seguro · Recibido");
    expect(words(itemOf(html, "other"))).toContain("Pool permit · Pendiente");
    expect(text).toContain("vence en 6 días");
    expect(text).toContain("Copiar enlace");
    expect(text).toContain("Anular");
  });

  it("the Other note is the customer's own words in no language (lang=\"\")", () => {
    expect(itemOf(render(ready([request()])), "other")).toMatch(/<span lang="">Pool permit<\/span>/);
  });

  it("an empty ready list draws nothing (mutation: draw the label for no requests -> FAILS)", () => {
    expect(render(ready([]))).toBe("");
  });

  it("loading draws a skeleton shaped like a row, with no copy and no spinner (rule 7)", () => {
    const html = render({ kind: "loading" });
    expect(html).toContain("data-document-requests-skeleton");
    expect(html).toContain('data-slot="skeleton"');
    expect(renderedText(html).trim()).toBe("");
    expect(html).not.toMatch(/animate-spin|spinner/);
  });

  it("error: its own sentence and a ghost Retry, announced, in both languages (spec 6: never the files'; mutation: draw the files' loadFailed -> FAILS)", () => {
    const html = render({ kind: "error" });
    expect(html).toMatch(/data-document-requests[^>]*role="alert"|role="alert"[^>]*data-document-requests/);
    expect(words(html)).toContain("Couldn't load the requests.");
    expect(words(html)).not.toContain(m["documents.loadFailed"]);
    expect(html).toMatch(/data-variant="ghost"[^>]*>Retry</);
    const es = words(render({ kind: "error" }, { locale: "es" }));
    expect(es).toContain("No se pudieron cargar los pedidos.");
    expect(es).toContain("Reintentar");
  });

  it("paints no literal colour (tokens only)", () => {
    expect(render(ready([request()]))).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
