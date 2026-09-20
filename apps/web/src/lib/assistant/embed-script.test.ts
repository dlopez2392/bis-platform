/* eslint-disable @typescript-eslint/no-explicit-any -- hand-built DOM fakes
   need loose typing to stand in for window/document/iframe; this file is not
   part of the shipped script and typing it strictly would fight the fakes
   rather than catch a real bug. */
import { describe, it, expect } from "vitest";
import { ASSISTANT_EMBED_SCRIPT } from "./embed-script";

type Listener = (event: any) => void;

const ORIGIN = "https://platform.example.com";

/** Minimal DOM good enough for the assistant embed script, so the real
 *  string can run — same technique `lib/forms/embed-script.test.ts` uses. */
function run(
  attrs: Record<string, string>,
  hostUrl: string,
  opts: { innerWidth?: number; referrer?: string } = {},
) {
  const style: Record<string, string> = {};
  const iframe: any = {
    style,
    setAttribute: (k: string, v: string) => { iframe[k] = v; },
    contentWindow: { id: "iframe-window", postMessage: (data: any, targetOrigin: string) => { iframe.posted.push({ data, targetOrigin }); } },
    posted: [] as { data: any; targetOrigin: string }[],
  };
  let messageListener: Listener | undefined;
  let keydownListener: Listener | undefined;
  const resizeListeners: (() => void)[] = [];
  const inserted: any[] = [];

  const script = {
    src: "https://platform.example.com/assistant.js",
    getAttribute: (name: string) => attrs[name] ?? null,
    parentNode: { insertBefore: (node: any) => inserted.push(node) },
    nextSibling: null,
  };

  const body = { style: { overflow: "" } };
  const document = { currentScript: script, referrer: opts.referrer ?? "", createElement: () => iframe, body };
  const win: any = {
    location: { search: new URL(hostUrl).search, href: hostUrl },
    innerWidth: opts.innerWidth ?? 1280,
    addEventListener: (type: string, fn: Listener | (() => void)) => {
      if (type === "message") messageListener = fn as Listener;
      if (type === "keydown") keydownListener = fn as Listener;
      if (type === "resize") resizeListeners.push(fn as () => void);
    },
  };

  new Function("window", "document", "URL", "URLSearchParams", ASSISTANT_EMBED_SCRIPT)(
    win, document, URL, URLSearchParams);

  return {
    iframe, inserted, win, body,
    sendMessage: (event: any) => messageListener?.(event),
    pressEscape: () => keydownListener?.({ key: "Escape" }),
    resize: () => resizeListeners.forEach((fn) => fn()),
  };
}

describe("assistant embed script", () => {
  it("does nothing without a data-assistant attribute", () => {
    const { inserted } = run({}, "https://client.example/");
    expect(inserted).toHaveLength(0);
  });

  it("injects an iframe pointing at the hosted assistant page, embed=1, closed size", () => {
    const { iframe, inserted } = run({ "data-assistant": "abc123def456" }, "https://client.example/contact");
    expect(inserted).toHaveLength(1);
    const url = new URL(iframe.src);
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/a/abc123def456`);
    expect(url.searchParams.get("embed")).toBe("1");
    expect(iframe.style.width).toBe("72px");
    expect(iframe.style.height).toBe("72px");
  });

  it("lifts utm and click ids off the HOST page url, and forwards locale/theme", () => {
    const { iframe } = run(
      { "data-assistant": "abc123def456", "data-locale": "es", "data-theme": "dark" },
      "https://client.example/contacto?utm_source=google&utm_medium=cpc&gclid=xyz&ignored=1",
      { referrer: "https://www.google.com/" },
    );
    const url = new URL(iframe.src);
    expect(url.searchParams.get("utm_source")).toBe("google");
    expect(url.searchParams.get("utm_medium")).toBe("cpc");
    expect(url.searchParams.get("gclid")).toBe("xyz");
    expect(url.searchParams.get("locale")).toBe("es");
    expect(url.searchParams.get("theme")).toBe("dark");
    expect(url.searchParams.get("page")).toBe(
      "https://client.example/contacto?utm_source=google&utm_medium=cpc&gclid=xyz&ignored=1");
    expect(url.searchParams.get("ref")).toBe("https://www.google.com/");
    expect(url.searchParams.get("ignored")).toBeNull();
  });

  it("ignores a theme value that is not light or dark — not a hint", () => {
    const { iframe } = run({ "data-assistant": "abc123def456", "data-theme": "auto" }, "https://client.example/");
    expect(new URL(iframe.src).searchParams.get("theme")).toBeNull();
  });

  it("resizes closed to open on a WIDE viewport to the min(400px/640px) card, bottom-right", () => {
    const { iframe, sendMessage } = run(
      { "data-assistant": "abc123def456" }, "https://client.example/", { innerWidth: 1280 });
    sendMessage({ source: iframe.contentWindow, origin: ORIGIN, data: { type: "bis-assistant-state", open: true } });
    expect(iframe.style.width).toBe("min(400px, calc(100vw - 32px))");
    expect(iframe.style.height).toBe("min(640px, calc(100vh - 32px))");
    expect(iframe.style.right).toBe("16px");
    expect(iframe.style.bottom).toBe("16px");
    expect(iframe.style.left).toBe("auto");
    expect(iframe.style.top).toBe("auto");
  });

  it("resizes closed to open on a NARROW viewport to full-bleed, inset 0", () => {
    const { iframe, sendMessage } = run(
      { "data-assistant": "abc123def456" }, "https://client.example/", { innerWidth: 375 });
    sendMessage({ source: iframe.contentWindow, origin: ORIGIN, data: { type: "bis-assistant-state", open: true } });
    expect(iframe.style.width).toBe("100vw");
    expect(iframe.style.height).toBe("100vh");
    expect(iframe.style.top).toBe("0px");
    expect(iframe.style.left).toBe("0px");
  });

  it("locks body scroll opening narrow, and restores the ORIGINAL value on close", () => {
    const { iframe, body, sendMessage } = run(
      { "data-assistant": "abc123def456" }, "https://client.example/", { innerWidth: 375 });
    body.style.overflow = "auto"; // the host page's own pre-existing value
    sendMessage({ source: iframe.contentWindow, origin: ORIGIN, data: { type: "bis-assistant-state", open: true } });
    expect(body.style.overflow).toBe("hidden");
    sendMessage({ source: iframe.contentWindow, origin: ORIGIN, data: { type: "bis-assistant-state", open: false } });
    expect(body.style.overflow).toBe("auto");
  });

  it("never locks body scroll opening on a WIDE viewport", () => {
    const { body, iframe, sendMessage } = run(
      { "data-assistant": "abc123def456" }, "https://client.example/", { innerWidth: 1280 });
    sendMessage({ source: iframe.contentWindow, origin: ORIGIN, data: { type: "bis-assistant-state", open: true } });
    expect(body.style.overflow).toBe("");
  });

  it("re-layouts a resize while open from narrow to wide", () => {
    const { iframe, sendMessage, win, resize } = run(
      { "data-assistant": "abc123def456" }, "https://client.example/", { innerWidth: 375 });
    sendMessage({ source: iframe.contentWindow, origin: ORIGIN, data: { type: "bis-assistant-state", open: true } });
    expect(iframe.style.width).toBe("100vw");
    win.innerWidth = 1280;
    resize();
    expect(iframe.style.width).toBe("min(400px, calc(100vw - 32px))");
  });

  it("ignores a state message from any other window", () => {
    const { iframe, sendMessage } = run({ "data-assistant": "abc123def456" }, "https://client.example/");
    const before = iframe.style.width;
    sendMessage({ source: { id: "someone-else" }, origin: ORIGIN, data: { type: "bis-assistant-state", open: true } });
    expect(iframe.style.width).toBe(before);
  });

  it("ignores a state message from the right window but the wrong origin", () => {
    const { iframe, sendMessage } = run({ "data-assistant": "abc123def456" }, "https://client.example/");
    const before = iframe.style.width;
    sendMessage({
      source: iframe.contentWindow, origin: "https://evil.example",
      data: { type: "bis-assistant-state", open: true },
    });
    expect(iframe.style.width).toBe(before);
  });

  it("Esc on the host page resizes closed immediately and posts bis-assistant-close into the iframe", () => {
    const { iframe, sendMessage, pressEscape } = run({ "data-assistant": "abc123def456" }, "https://client.example/");
    sendMessage({ source: iframe.contentWindow, origin: ORIGIN, data: { type: "bis-assistant-state", open: true } });
    pressEscape();
    expect(iframe.style.width).toBe("72px");
    expect(iframe.posted.at(-1)).toEqual({ data: { type: "bis-assistant-close" }, targetOrigin: ORIGIN });
  });

  it("Esc does nothing while already closed", () => {
    const { iframe, pressEscape } = run({ "data-assistant": "abc123def456" }, "https://client.example/");
    pressEscape();
    expect(iframe.posted).toHaveLength(0);
  });

  it("window.BISAssistant.open() resizes open and tells the widget to open", () => {
    const { iframe, win } = run({ "data-assistant": "abc123def456" }, "https://client.example/");
    win.BISAssistant.open();
    expect(iframe.style.width).not.toBe("72px");
    expect(iframe.posted.at(-1)).toEqual({ data: { type: "bis-assistant-open" }, targetOrigin: ORIGIN });
  });

  it("window.BISAssistant.close() resizes closed and tells the widget to close", () => {
    const { iframe, win, sendMessage } = run({ "data-assistant": "abc123def456" }, "https://client.example/");
    sendMessage({ source: iframe.contentWindow, origin: ORIGIN, data: { type: "bis-assistant-state", open: true } });
    win.BISAssistant.close();
    expect(iframe.style.width).toBe("72px");
    expect(iframe.posted.at(-1)).toEqual({ data: { type: "bis-assistant-close" }, targetOrigin: ORIGIN });
  });
});
