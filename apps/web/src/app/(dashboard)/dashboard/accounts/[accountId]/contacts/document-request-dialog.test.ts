import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");
const { DocumentRequestForm, requestFromForm, requestTitle, chosenChannel } = await import("./document-request-dialog");
type Props = Parameters<typeof DocumentRequestForm>[0];

const render = (over: Partial<Props> = {}) => renderToStaticMarkup(createElement(DocumentRequestForm, {
  locale: "en", name: "Ana", channels: { text: true, email: true }, busy: false, error: null, onSubmit: vi.fn(), onCancel: vi.fn(), ...over,
} as Props));
/** Whitespace runs as one space: renderedText turns every tag into a space. */
const words = (html: string) => renderedText(html).replace(/\s+/g, " ");
/** The radio input for one channel, its own tag only. */
const radio = (html: string, ch: string) => new RegExp(`<input[^>]*value="${ch}"[^>]*>`).exec(html)![0];
/** One category's label row, from its opening tag to its close. */
const categoryRow = (html: string, c: string) => {
  const at = html.indexOf(`data-request-category="${c}"`);
  return html.slice(html.lastIndexOf("<label", at), html.indexOf("</label>", at));
};

describe("the Ask the customer form (spec 4.2)", () => {
  it("lists the nine categories as checkboxes with their words, in the vault's order, and the three channels as radios", () => {
    const html = render();
    expect(html.match(/role="checkbox"/g)).toHaveLength(9);
    const order = [...html.matchAll(/data-request-category="([a-z]+)"/g)].map((x) => x[1]);
    expect(order).toEqual(["id", "contract", "estimate", "invoice", "photo", "permit", "insurance", "warranty", "other"]);
    for (const c of order) expect(words(categoryRow(html, c!))).toContain(m[`documents.category.${c}` as keyof typeof m]);
    expect(html.match(/<input[^>]*type="radio"/g)).toHaveLength(3);
    const text = words(html);
    expect(text).toContain("What do you need?");
    expect(text).toContain("How should it go?");
    const channelRow = (ch: string) => {
      const at = html.indexOf(`data-request-channel="${ch}"`);
      return words(html.slice(html.lastIndexOf("<label", at), html.indexOf("</label>", at))).trim();
    };
    expect(channelRow("text")).toBe("Text");
    expect(channelRow("email")).toBe("Email");
    expect(channelRow("link")).toBe("Copy link");
  });

  it("the Other note field shows only while Other is ticked, labelled, capped at 80 (mutation: always draw it -> FAILS)", () => {
    expect(render()).not.toContain("data-request-note");
    const html = render({ initialItems: ["other"] });
    const input = /<input[^>]*data-request-note[^>]*>/.exec(html)![0];
    expect(input).toContain('maxLength="80"');
    expect(words(html)).toContain("What is it?");
  });

  it("with text and email both on offer, Text is selected (mutation: pre-select Email when Text is available -> FAILS)", () => {
    const html = render();
    expect(radio(html, "text")).toContain('checked=""');
    expect(radio(html, "email")).not.toContain('checked=""');
    expect(radio(html, "link")).not.toContain('checked=""');
    expect(radio(html, "text")).not.toContain("disabled");
  });

  it("with no texting, Email is selected and Text is disabled with its sentence beside it", () => {
    const html = render({ channels: { text: false, email: true } });
    expect(radio(html, "email")).toContain('checked=""');
    expect(radio(html, "text")).toContain('disabled=""');
    expect(radio(html, "text")).not.toContain('checked=""');
    const textRow = html.slice(html.indexOf('data-request-channel="text"'), html.indexOf('data-request-channel="email"'));
    expect(words(textRow)).toContain("Texting isn't available for this customer.");
    expect(words(html)).not.toContain(m["documents.request.emailOff"]);
  });

  it("with neither, only Copy link: it is selected and both others are disabled with their sentences", () => {
    const html = render({ channels: { text: false, email: false } });
    expect(radio(html, "link")).toContain('checked=""');
    expect(radio(html, "link")).not.toContain("disabled");
    expect(radio(html, "text")).toContain('disabled=""');
    expect(radio(html, "email")).toContain('disabled=""');
    expect(words(html)).toContain("There's no email address on file.");
  });

  it("exactly ONE primary: Send request for text or email, Create link for link; Cancel is ghost (rule 8; mutation: a second primary -> FAILS)", () => {
    const send = render();
    expect(send.match(/data-variant="default"/g)).toHaveLength(1);
    expect(send).toMatch(/data-variant="default"[^>]*>Send request</);
    expect(send).toMatch(/data-variant="ghost"[^>]*>Cancel</);
    const email = render({ channels: { text: false, email: true } });
    expect(email).toMatch(/data-variant="default"[^>]*>Send request</);
    const link = render({ channels: { text: false, email: false } });
    expect(link.match(/data-variant="default"/g)).toHaveLength(1);
    expect(link).toMatch(/data-variant="default"[^>]*>Create link</);
  });

  it("busy disables the primary and keeps its label, no spinner (rule 7)", () => {
    const html = render({ busy: true });
    expect(/<button[^>]*data-variant="default"[^>]*>/.exec(html)![0]).toContain('disabled=""');
    expect(html).toMatch(/data-variant="default"[^>]*>Send request</);
    expect(html).not.toMatch(/animate-spin|spinner/);
  });

  it("initialItems tick their categories (2c's seam; mutation: ignore initialItems -> FAILS)", () => {
    const html = render({ initialItems: ["insurance"] });
    expect(categoryRow(html, "insurance")).toContain('aria-checked="true"');
    expect(categoryRow(html, "contract")).toContain('aria-checked="false"');
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
  });

  it("the action's error shows under the fields as an alert, in the reader's words", () => {
    const html = render({ error: "documents.request.textOff", locale: "es", channels: { text: false, email: true } });
    expect(html).toMatch(/role="alert"[^>]*>No se le pueden enviar mensajes de texto a este cliente\.</);
    expect(render()).not.toContain('role="alert"');
  });

  it("Spanish (usted): the title, the question and the primary, compared with literals (mutation: an English word -> FAILS)", () => {
    const text = words(render({ locale: "es" }));
    expect(text).toContain("Pedir documentos a Ana");
    expect(text).toContain("¿Qué necesita?");
    expect(text).toContain("Enviar pedido");
    expect(text).toContain("Seguro");
    expect(text).toContain("Cancelar");
    expect(text).not.toContain("Send request");
    expect(words(render({ locale: "es", channels: { text: false, email: false } }))).toContain("Crear enlace");
  });

  it("the title names the customer, or reads Ask the customer when the card was given no name", () => {
    expect(requestTitle("Ana", "en")).toBe("Ask Ana for documents");
    expect(requestTitle("", "es")).toBe("Pedir al cliente");
    expect(requestTitle("  ", "en")).toBe("Ask the customer");
  });

  it("paints no literal colour (tokens only)", () => {
    expect(render({ error: "documents.request.pickOne", initialItems: ["other"], channels: { text: false, email: false } })).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("chosenChannel (pure, review M3)", () => {
  it("keeps the person's choice while it is on offer; the link is always on offer", () => {
    expect(chosenChannel("email", { text: true, email: true })).toBe("email");
    expect(chosenChannel("link", { text: false, email: false })).toBe("link");
    expect(chosenChannel("text", { text: true, email: false })).toBe("text");
  });
  it("a choice a re-read took away falls back to the seed, never a disabled radio left checked (mutation: return the choice as is -> FAILS)", () => {
    expect(chosenChannel("text", { text: false, email: true })).toBe("email");
    expect(chosenChannel("email", { text: true, email: false })).toBe("text");
    expect(chosenChannel("text", { text: false, email: false })).toBe("link");
  });
});

describe("requestFromForm (pure)", () => {
  it("nothing ticked answers pickOne", () => {
    expect(requestFromForm({ picked: new Set(), note: "" })).toEqual({ error: "documents.request.pickOne" });
  });
  it("Other with an empty or blank note answers noteNeeded (mutation: submit Other with no note -> FAILS)", () => {
    expect(requestFromForm({ picked: new Set(["other"]), note: "" })).toEqual({ error: "documents.request.noteNeeded" });
    expect(requestFromForm({ picked: new Set(["insurance", "other"]), note: "   " })).toEqual({ error: "documents.request.noteNeeded" });
  });
  it("otherwise the cleaned items, in the vault's order whatever order they were ticked, the note trimmed and only on Other", () => {
    expect(requestFromForm({ picked: new Set(["other", "insurance", "id"]), note: "  Pool permit " })).toEqual({ items: [
      { key: "id", category: "id", note: null },
      { key: "insurance", category: "insurance", note: null },
      { key: "other", category: "other", note: "Pool permit" },
    ] });
  });
});
