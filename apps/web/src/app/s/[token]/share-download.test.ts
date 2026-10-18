import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderedText } from "@/lib/rendered-text";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ShareDownload, ShareDownloadView, downloadOutcome, requestDownload, settleDownload, SHARE_CSS, type DownloadDeps } from "./share-download";

const SOURCE = readFileSync(fileURLToPath(new URL("./share-download.tsx", import.meta.url)), "utf8");
const SIGNED = "https://x.supabase.co/storage/v1/object/sign/documents/a?token=t&download=f";
const LOCAL = "http://127.0.0.1:54321/storage/v1/object/sign/documents/a?token=t";
const TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("downloadOutcome: the route's answer, as the button acts on it", () => {
  it("200 with an https URL: go there", () => {
    expect(downloadOutcome(200, { url: SIGNED })).toEqual({ kind: "go", url: SIGNED });
  });
  it("200 with the CI stack's http URL: go there", () => {
    expect(downloadOutcome(200, { url: LOCAL })).toEqual({ kind: "go", url: LOCAL });
  });
  it.each<[string, unknown]>([
    ["a javascript: URL", { url: "javascript:alert(1)" }],
    ["a javascript: URL carrying an https URL inside it (the ^ anchor; review M1)", { url: "javascript:alert('https://x')" }],
    ["a data: URL", { url: "data:text/html,hi" }],
    ["a relative path", { url: "/api/s/x/download" }],
    ["no url", {}],
    ["a non-string url", { url: 7 }],
    ["no body", null],
  ])("200 with %s: failed, never followed (mutation: accept any string url → FAILS)", (_name, body) => {
    expect(downloadOutcome(200, body)).toEqual({ kind: "failed" });
  });
  it("410: re-read the page into its refusal", () => {
    expect(downloadOutcome(410, { error: "unavailable" })).toEqual({ kind: "refresh" });
  });
  it("429: the rate-limit sentence", () => {
    expect(downloadOutcome(429, { error: "rate_limited" })).toEqual({ kind: "limit" });
  });
  it.each([503, 500, 404])("%s: the retry sentence", (status) => {
    expect(downloadOutcome(status, { error: "failed" })).toEqual({ kind: "failed" });
  });
});

/** A fetch double answering one status and body, recording every call it was given. */
function fakeFetch(status: number, body: unknown) {
  return vi.fn<(input: string, init: RequestInit) => Promise<Response>>(async () => ({ status, json: async () => body }) as unknown as Response);
}

describe("requestDownload: a fetch POST to the route, then the browser goes to the signed URL (Task 7 review)", () => {
  it("POSTs to /api/s/<token>/download with fetch, asking for JSON and sending no Referer (mutation: GET → FAILS)", async () => {
    const f = fakeFetch(200, { url: SIGNED });
    await requestDownload(TOKEN, { fetch: f, go: vi.fn(), refresh: vi.fn() });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(`/api/s/${TOKEN}/download`);
    expect(init).toEqual({ method: "POST", cache: "no-store", referrerPolicy: "no-referrer", headers: { accept: "application/json" } });
  });

  it("200: the browser goes to the returned URL, nothing else (mutation: go to the route itself → FAILS)", async () => {
    const go = vi.fn();
    const refresh = vi.fn();
    expect(await requestDownload(TOKEN, { fetch: fakeFetch(200, { url: SIGNED }), go, refresh })).toBeNull();
    expect(go.mock.calls).toEqual([[SIGNED]]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("410: the page re-reads (into its refusal), and the browser goes nowhere", async () => {
    const go = vi.fn();
    const refresh = vi.fn();
    expect(await requestDownload(TOKEN, { fetch: fakeFetch(410, { error: "unavailable" }), go, refresh })).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(go).not.toHaveBeenCalled();
  });

  it("429: the limit note; 503: the failed note; neither goes anywhere nor re-reads", async () => {
    const go = vi.fn();
    const refresh = vi.fn();
    expect(await requestDownload(TOKEN, { fetch: fakeFetch(429, { error: "rate_limited" }), go, refresh })).toBe("limit");
    expect(await requestDownload(TOKEN, { fetch: fakeFetch(503, { error: "failed" }), go, refresh })).toBe("failed");
    expect(go).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a network failure or an unreadable body: the failed note", async () => {
    const offline = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    expect(await requestDownload(TOKEN, { fetch: offline, go: vi.fn(), refresh: vi.fn() })).toBe("failed");
    const garbled = vi.fn(async () => ({ status: 200, json: async () => { throw new SyntaxError("bad json"); } }) as unknown as Response);
    const go = vi.fn();
    expect(await requestDownload(TOKEN, { fetch: garbled, go, refresh: vi.fn() })).toBe("failed");
    expect(go).not.toHaveBeenCalled();
  });
});

describe("the source never sends the browser to the route as a document (Task 7 review: Clerk's handshake on /api)", () => {
  it("no <form>, no action=, no formAction, no link or navigation to /api/s (mutation: a <form action> → FAILS)", () => {
    expect(SOURCE).not.toMatch(/<form\b/);
    expect(SOURCE).not.toMatch(/\baction=|formAction/);
    expect(SOURCE).not.toMatch(/href=\{?[`"']\/api\/s/);
    expect(SOURCE).not.toMatch(/location\.(assign|replace)\(\s*[`"']\/api/);
    expect(SOURCE).not.toMatch(/location\.href\s*=/);
  });
  it("the route is named once, inside the fetch, and the component's one navigation is the returned URL", () => {
    expect(SOURCE).toMatch(/deps\.fetch\(`\/api\/s\/\$\{encodeURIComponent\(token\)\}\/download`/);
    expect(SOURCE.match(/\/api\/s\//g)).toHaveLength(1);
    expect(SOURCE.match(/window\.location/g)).toHaveLength(1);
    expect(SOURCE).toMatch(/go: \(url\) => window\.location\.assign\(url\)/);
  });
});

describe("ShareDownload: the page's one primary (rule 8), never a spinner (rule 7)", () => {
  const html = renderToStaticMarkup(createElement(ShareDownload, { token: TOKEN, label: "Descargar", limitText: "L", failedText: "F" }));
  it("one bis-docreq-primary button, type=button, carrying its label and its marker, enabled at rest", () => {
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html.match(/class="bis-docreq-primary"/g)).toHaveLength(1);
    expect(html).toMatch(/<button type="button" class="bis-docreq-primary" data-share-download="true"[^>]*>Descargar<\/button>/);
    expect(html).not.toMatch(/<button[^>]*\sdisabled/);
    expect(html).toContain('aria-disabled="false"');
  });
  it("the note region stands empty at rest, as a polite live region, so a later sentence is announced", () => {
    expect(html).toMatch(/<p role="status" aria-live="polite" class="bis-docreq-detail" data-share-note="true"><\/p>/);
    expect(renderedText(html.replace(/<style>[\s\S]*?<\/style>/g, "")).trim()).toBe("Descargar");
  });
  it("never carries the token into the markup", () => {
    expect(html).not.toContain(TOKEN);
  });
  it("a busy button reads as busy without a spinner: dimmed through aria-disabled, not clickable-looking (its own CSS, no colour of its own)", () => {
    expect(html).toContain(`<style>${SHARE_CSS}</style>`);
    expect(SHARE_CSS).toMatch(/\.bis-docreq-primary\[aria-disabled="true"\] \{ opacity: 0\.6; cursor: default; \}/);
    expect(SHARE_CSS).not.toMatch(/:disabled/);
    expect(SHARE_CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl|animation|@keyframes/i);
  });
  it("a late sentence stands 8px below the button only when it has words (review M4)", () => {
    expect(SHARE_CSS).toMatch(/\.bis-docreq-detail\[data-share-note\]:not\(:empty\) \{ margin-top: 8px; \}/);
  });
});

describe("ShareDownloadView: busy keeps the button focusable (review M3)", () => {
  const view = (busy: boolean, note: string | null = null) =>
    renderToStaticMarkup(createElement(ShareDownloadView, { label: "Download", busy, note, onClick: () => {} }));
  it("busy: aria-disabled and aria-busy, never the disabled attribute, which would drop keyboard focus (mutation: disabled={busy} → FAILS)", () => {
    const html = view(true);
    expect(html).toMatch(/<button type="button" class="bis-docreq-primary" data-share-download="true" aria-disabled="true" aria-busy="true">Download<\/button>/);
    expect(html).not.toMatch(/<button[^>]*\sdisabled/);
  });
  it("at rest: aria-disabled is false and there is no aria-busy", () => {
    const html = view(false);
    expect(html).toMatch(/<button type="button" class="bis-docreq-primary" data-share-download="true" aria-disabled="false">Download<\/button>/);
  });
  it("the note's words go in the live region", () => {
    expect(view(false, "Too many downloads from here. Try again in a few minutes.")).toMatch(
      /<p role="status" aria-live="polite" class="bis-docreq-detail" data-share-note="true">Too many downloads from here\. Try again in a few minutes\.<\/p>/,
    );
  });
});

describe("settleDownload: the answer's sentence, and busy cleared (review M2)", () => {
  const WORDS = { limitText: "Too many downloads from here. Try again in a few minutes.", failedText: "The download didn't start. Try again." };
  const press = async (f: DownloadDeps["fetch"], refresh = vi.fn()) => settleDownload(await requestDownload(TOKEN, { fetch: f, go: vi.fn(), refresh }), WORDS);
  it("429: the rate-limit sentence (mutation: swap the two sentences → FAILS)", async () => {
    expect(await press(fakeFetch(429, { error: "rate_limited" }))).toEqual({ busy: false, note: WORDS.limitText });
  });
  it("503 and a network failure: the retry sentence", async () => {
    expect(await press(fakeFetch(503, { error: "failed" }))).toEqual({ busy: false, note: WORDS.failedText });
    expect(await press(vi.fn(async () => { throw new TypeError("Failed to fetch"); }))).toEqual({ busy: false, note: WORDS.failedText });
  });
  it("410: the page re-reads, and no sentence", async () => {
    const refresh = vi.fn();
    expect(await press(fakeFetch(410, { error: "unavailable" }), refresh)).toEqual({ busy: false, note: null });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("200: the browser went on, no sentence", async () => {
    expect(await press(fakeFetch(200, { url: SIGNED }))).toEqual({ busy: false, note: null });
  });
});
