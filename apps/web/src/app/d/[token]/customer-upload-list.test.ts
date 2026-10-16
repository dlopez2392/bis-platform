import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import type { CustomerFile } from "@/lib/document-requests/customer-state";
import type { CustomerPhase } from "@/lib/document-requests/customer-client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CustomerUploadView, afterUpload } from "./customer-upload-list";

type Item = { key: string; label: string; files: CustomerFile[]; local: CustomerPhase[] };
const item = (o: Partial<Item> = {}): Item => ({ key: "id", label: "ID", files: [], local: [], ...o });
const view = (locale: "en" | "es", items: Item[], business: string | null = "Casa Verde") =>
  renderToStaticMarkup(createElement(CustomerUploadView, { locale, business, items, onPick: () => {} }));
const text = (locale: "en" | "es", items: Item[]) => renderedText(view(locale, items)).replace(/\s+/g, " ");
/** Each item's own markup, so "one primary per item" is counted per item, not across the list. */
const itemsOf = (html: string) => html.split(/(?=<li[^>]*data-docreq-item)/).slice(1);
/** Each status line's own markup (a dot, then its word). */
const linesOf = (html: string) => [...html.matchAll(/<li class="bis-docreq-line"[^>]*>(.*?)<\/li>/g)].map((x) => x[1]!);

const FULL: CustomerPhase = { kind: "refused", why: "customerDocs.why.full", params: { phone: "(956) 555-0123" } };
const FULL_NO_PHONE: CustomerPhase = { kind: "refused", why: "customerDocs.why.fullNoPhone" };

describe("CustomerUploadView: the words", () => {
  it("(plan review I7) a local over-quota refusal names the business AND the phone, in English and Spanish (mutation: drop business from the view's params → FAILS)", () => {
    expect(text("en", [item({ local: [FULL] })])).toContain("Please call Casa Verde at (956) 555-0123.");
    expect(text("es", [item({ local: [FULL] })])).toContain("Por favor llame a Casa Verde al (956) 555-0123.");
  });

  it("without a phone: the business alone, in English and Spanish", () => {
    expect(text("en", [item({ local: [FULL_NO_PHONE] })])).toContain("Please call Casa Verde.");
    expect(text("es", [item({ local: [FULL_NO_PHONE] })])).toContain("Por favor llame a Casa Verde.");
  });

  const EVERY_PHASE: CustomerPhase[] = [
    { kind: "uploading", percent: 45 }, { kind: "checking" }, { kind: "received" }, { kind: "failed" }, FULL, FULL_NO_PHONE,
    ...(["type", "size", "limit", "virus", "password", "unscannable"] as const).map((w): CustomerPhase => ({ kind: "refused", why: `customerDocs.why.${w}` })),
  ];
  const EVERY_FILE: CustomerFile[] = (["checking", "received", "virus", "password", "unscannable"] as const).map((state) => ({ state, ageMs: 1000 }));

  it.each(["en", "es"] as const)("(%s) no rendered line leaves a placeholder unfilled: no '{' anywhere (mutation: drop business → '{business}' is left → FAILS)", (locale) => {
    const t = text(locale, [item({ files: EVERY_FILE, local: EVERY_PHASE })]);
    expect(t).not.toContain("{");
    expect(t).not.toContain("}");
  });

  it("server files are a dot AND a word, never colour alone: Received, Checking, and a removed file prefixed by the refusal (rule 3)", () => {
    const html = view("en", [item({ files: [
      { state: "received", ageMs: 0 }, { state: "checking", ageMs: 0 }, { state: "virus", ageMs: 0 },
    ] })]);
    const lines = linesOf(html);
    expect(lines.map((l) => renderedText(l).replace(/\s+/g, " ").trim())).toEqual([
      "Received", "Checking", "We couldn't accept this file · It had a virus.",
    ]);
    for (const l of lines) expect(l).toMatch(/^<span class="bis-docreq-dot bis-docreq-dot--(good|warn|crit)" aria-hidden="true"><\/span>/);
    expect(lines[0]).toContain("bis-docreq-dot--good");
    expect(lines[1]).toContain("bis-docreq-dot--warn");
    expect(lines[2]).toContain("bis-docreq-dot--crit");
  });

  it("a password-protected and an unscannable file each read their own reason after the refusal", () => {
    const t = text("en", [item({ files: [{ state: "password", ageMs: 0 }, { state: "unscannable", ageMs: 0 }] })]);
    expect(t).toContain("We couldn't accept this file · It has a password: remove it and upload it again.");
    expect(t).toContain("We couldn't accept this file · We couldn't check it. Try another copy.");
  });

  it("a local upload in flight reads 'Uploading 45 %', with a dot, and nothing spins (rule 7)", () => {
    const html = view("en", [item({ local: [{ kind: "uploading", percent: 45 }] })]);
    expect(linesOf(html).map((l) => renderedText(l).trim())).toEqual(["Uploading 45 %"]);
    expect(html).not.toMatch(/animate-|spinner|spin/i);
  });

  it("a failed upload says so in words", () => {
    expect(text("en", [item({ local: [{ kind: "failed" }] })])).toContain("Didn't upload. Try again.");
    expect(text("es", [item({ local: [{ kind: "failed" }] })])).toContain("No se subió. Intente de nuevo.");
  });

  it("Spanish: 'Subiendo 45 %', 'Revisando', 'Recibido', 'Subir', 'Tomar foto' (literals, not the catalogue read back)", () => {
    const t = text("es", [item({ files: [{ state: "received", ageMs: 0 }], local: [{ kind: "uploading", percent: 45 }, { kind: "checking" }] })]);
    for (const s of ["Subiendo 45 %", "Revisando", "Recibido", "Subir", "Tomar foto"]) expect(t).toContain(s);
    expect(t).not.toContain("Uploading");
    expect(t).not.toContain("Take photo");
  });

  it("names no file and no size: a file the server listed carries none to show (mutation: render the file name → FAILS)", () => {
    const leaky = { state: "received", ageMs: 0, name: "Lease 2026 signed.pdf", size: 1234567 } as unknown as CustomerFile;
    const t = text("en", [item({ files: [leaky] })]);
    expect(t).not.toContain("Lease 2026");
    expect(t).not.toContain("1234567");
    expect(t).not.toMatch(/\bKB\b|\bMB\b/);
  });
});

describe("CustomerUploadView: the controls", () => {
  const items = [item({ key: "id", label: "ID" }), item({ key: "other", label: "Proof of address" })];

  it("each item: its label, ONE primary Upload and a ghost Take photo, each behind its own hidden file input (rule 8, per item)", () => {
    const parts = itemsOf(view("en", items));
    expect(parts).toHaveLength(2);
    expect(renderedText(parts[0]!)).toContain("ID");
    expect(renderedText(parts[1]!)).toContain("Proof of address");
    for (const p of parts) {
      expect(p.match(/class="bis-docreq-primary"/g)).toHaveLength(1);
      expect(p.match(/class="bis-docreq-ghost bis-docreq-photo"/g)).toHaveLength(1);
      expect(renderedText(p)).toMatch(/Upload/);
      expect(renderedText(p)).toMatch(/Take photo/);
      const inputs = p.match(/<input[^>]*>/g) ?? [];
      expect(inputs).toHaveLength(2);
      expect(inputs.filter((i) => /capture="environment"/.test(i) && /accept="image\/\*"/.test(i))).toHaveLength(1);
      expect(inputs.filter((i) => /accept="\.pdf,\.jpg,\.jpeg,\.png,\.webp,\.docx,\.xlsx,application\/pdf,image\/\*"/.test(i) && !/capture=/.test(i))).toHaveLength(1);
      for (const i of inputs) expect(i).toMatch(/type="file"/);
      for (const i of inputs) expect(i).toMatch(/hidden=""/);
    }
  });

  it("the buttons are real buttons (keyboard-reachable), never a label over a hidden input", () => {
    const p = itemsOf(view("en", items))[0]!;
    expect(p.match(/<button type="button"/g)).toHaveLength(2);
  });
});

describe("CustomerUploadView: no brand name (Task 9 review, Important)", () => {
  it("the over-quota refusal reads its own no-name sentence, exactly, in English and Spanish: never \"llame a el negocio\" (mutation: always use the {business} key → FAILS)", () => {
    const lines = (locale: "en" | "es", p: CustomerPhase) => linesOf(view(locale, [item({ local: [p] })], null)).map((l) => renderedText(l).trim());
    expect(lines("en", FULL)).toEqual(["We couldn't accept this file · Please call the business at (956) 555-0123."]);
    expect(lines("es", FULL)).toEqual(["No pudimos aceptar este archivo · Por favor llame al negocio al (956) 555-0123."]);
    expect(lines("en", FULL_NO_PHONE)).toEqual(["We couldn't accept this file · Please call the business."]);
    expect(lines("es", FULL_NO_PHONE)).toEqual(["No pudimos aceptar este archivo · Por favor llame al negocio."]);
  });
});

/** What a live region can announce: the words outside every aria-hidden span (the dot, and an upload's moving percent). */
const liveText = (html: string) => renderedText(html.replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, "")).replace(/\s+/g, " ").trim();

describe("CustomerUploadView: what the live region announces (Task 9 review, minor 3)", () => {
  it("the moving percent is a progressbar, hidden from the live text: 45 % and 46 % announce the same, so only phase changes are heard (mutation: percent not aria-hidden → FAILS)", () => {
    const at = (percent: number) => view("en", [item({ local: [{ kind: "uploading", percent }] })]);
    expect(liveText(at(45))).toBe(liveText(at(46)));
    expect(at(45)).toMatch(/role="progressbar"[^>]*aria-valuenow="45"/);
    expect(at(45)).toMatch(/role="progressbar"[^>]*aria-label="Uploading 45 %"/);
  });

  it("a phase change IS announced: Uploading, then Checking, then Received each change the live text", () => {
    const of = (p: CustomerPhase) => liveText(view("es", [item({ local: [p] })]));
    const uploading = of({ kind: "uploading", percent: 10 });
    expect(of({ kind: "checking" })).not.toBe(uploading);
    expect(of({ kind: "checking" })).toContain("Revisando");
    expect(of({ kind: "received" })).toContain("Recibido");
  });

  it("the Received and Checking words are never hidden from it", () => {
    const t = liveText(view("en", [item({ files: [{ state: "received", ageMs: 0 }, { state: "checking", ageMs: 0 }] })]));
    expect(t).toContain("Received");
    expect(t).toContain("Checking");
  });
});

describe("afterUpload: what the list does when one upload ends", () => {
  it.each<[string, ReturnType<typeof afterUpload>, CustomerPhase]>([
    ["received", "server", { kind: "received" }],
    ["checking", "server", { kind: "checking" }],
    ["a virus", "server", { kind: "refused", why: "customerDocs.why.virus" }],
    ["a password", "server", { kind: "refused", why: "customerDocs.why.password" }],
    ["unscannable", "server", { kind: "refused", why: "customerDocs.why.unscannable" }],
    ["closed", "closed", { kind: "closed" }],
    ["failed before anything was stored", "local", { kind: "failed" }],
    ["failed AFTER a good PUT (the server may have filed it; Task 9 review ruling)", "refresh", { kind: "failed", maybeStored: true }],
    ["a wrong type", "local", { kind: "refused", why: "customerDocs.why.type" }],
    ["too large", "local", { kind: "refused", why: "customerDocs.why.size" }],
    ["the daily limit", "local", { kind: "refused", why: "customerDocs.why.limit" }],
    ["storage full", "local", FULL],
  ])("%s → %s (the server lists a scanned file; a refusal before storing stays as the page's own line; mutations: keep a virus local, or no refresh after a post-PUT failure → FAILS)", (_n, expected, end) => {
    expect(afterUpload(end)).toBe(expected);
  });
});
