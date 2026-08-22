/* eslint-disable @typescript-eslint/no-explicit-any -- hand-built DOM fakes
   need loose typing to stand in for window/document/iframe; this file is not
   part of the shipped script and typing it strictly would fight the fakes
   rather than catch a real bug. */
import { describe, it, expect } from "vitest";
import { EMBED_SCRIPT } from "./embed-script";

type Listener = (event: any) => void;

/** Minimal DOM good enough for the embed script, so the real string can run. */
function run(attrs: Record<string, string>, hostUrl: string, referrer = "") {
  const iframe: any = { style: {}, setAttribute: (k: string, v: string) => { iframe[k] = v; }, contentWindow: { id: "iframe-window" } };
  let listener: Listener | undefined;
  const inserted: any[] = [];

  const script = {
    src: "https://platform.example.com/embed.js",
    getAttribute: (name: string) => attrs[name] ?? null,
    parentNode: { insertBefore: (node: any) => inserted.push(node) },
    nextSibling: null,
  };

  const document = { currentScript: script, referrer, createElement: () => iframe };
  const win: any = {
    location: { search: new URL(hostUrl).search, href: hostUrl },
    addEventListener: (type: string, fn: Listener) => { if (type === "message") listener = fn; },
    top: { location: { href: "" } },
  };
  win.parent = win;

  new Function("window", "document", "URL", "URLSearchParams", EMBED_SCRIPT)(
    win, document, URL, URLSearchParams);

  return { iframe, inserted, win, send: (event: any) => listener?.(event) };
}

/**
 * Two independent `<script data-form>` embeds on one host page share a single
 * real `window` — both `addEventListener("message", ...)` calls land on the
 * same target and BOTH listeners run for every message. The single-embed
 * `run()` fake only keeps the last-registered listener, which can't exercise
 * that. This fake keeps an array of listeners (like a real window would) and
 * a separate iframe/script/document per embed, so a message's source check
 * is what proves isolation, not test plumbing.
 */
function runTwoEmbeds(hostUrl: string) {
  const listeners: Listener[] = [];
  const win: any = {
    location: { search: new URL(hostUrl).search, href: hostUrl },
    addEventListener: (type: string, fn: Listener) => { if (type === "message") listeners.push(fn); },
    top: { location: { href: "" } },
  };
  win.parent = win;

  function install(formId: string) {
    const iframe: any = { style: {}, setAttribute: (k: string, v: string) => { iframe[k] = v; }, contentWindow: { id: "iframe-" + formId } };
    const script = {
      src: "https://platform.example.com/embed.js",
      getAttribute: (name: string) => (name === "data-form" ? formId : null),
      parentNode: { insertBefore: () => {} },
      nextSibling: null,
    };
    const document = { currentScript: script, referrer: "", createElement: () => iframe };
    new Function("window", "document", "URL", "URLSearchParams", EMBED_SCRIPT)(
      win, document, URL, URLSearchParams);
    return iframe;
  }

  const iframeA = install("form-a");
  const iframeB = install("form-b");

  return { iframeA, iframeB, send: (event: any) => { for (const fn of listeners) fn(event); } };
}

const ORIGIN = "https://platform.example.com";

describe("embed script", () => {
  it("injects an iframe pointing at the hosted form page", () => {
    const { iframe, inserted } = run({ "data-form": "abc123def456" }, "https://client.example/contact");
    expect(inserted).toHaveLength(1);
    expect(iframe.src).toContain(`${ORIGIN}/f/abc123def456`);
    expect(iframe.style.width).toBe("100%");
  });

  it("lifts utm and click ids off the HOST page url, which the iframe cannot see", () => {
    const { iframe } = run(
      { "data-form": "abc123def456", "data-locale": "es" },
      "https://client.example/contacto?utm_source=google&utm_medium=cpc&gclid=xyz&ignored=1",
      "https://www.google.com/",
    );
    const url = new URL(iframe.src);
    expect(url.searchParams.get("utm_source")).toBe("google");
    expect(url.searchParams.get("utm_medium")).toBe("cpc");
    expect(url.searchParams.get("gclid")).toBe("xyz");
    expect(url.searchParams.get("locale")).toBe("es");
    expect(url.searchParams.get("page")).toBe(
      "https://client.example/contacto?utm_source=google&utm_medium=cpc&gclid=xyz&ignored=1");
    expect(url.searchParams.get("ref")).toBe("https://www.google.com/");
    expect(url.searchParams.get("ignored")).toBeNull();
  });

  it("resizes on a height message from its own iframe", () => {
    const { iframe, send } = run({ "data-form": "abc123def456" }, "https://client.example/");
    send({ source: iframe.contentWindow, origin: ORIGIN, data: { type: "bis-form-height", height: 812.4 } });
    expect(iframe.style.height).toBe("813px");
  });

  it("ignores a height message from any other window", () => {
    const { iframe, send } = run({ "data-form": "abc123def456" }, "https://client.example/");
    const before = iframe.style.height;

    send({ source: { id: "someone-else" }, origin: ORIGIN, data: { type: "bis-form-height", height: 4000 } });
    expect(iframe.style.height).toBe(before);

    // Right window, wrong origin — also refused.
    send({ source: iframe.contentWindow, origin: "https://evil.example", data: { type: "bis-form-height", height: 4000 } });
    expect(iframe.style.height).toBe(before);
  });

  it("navigates the top window on a redirect message, not the iframe", () => {
    const { iframe, send, win } = run({ "data-form": "abc123def456" }, "https://client.example/");
    send({ source: iframe.contentWindow, origin: ORIGIN,
           data: { type: "bis-form-redirect", url: "https://client.example/thanks" } });
    expect(win.top.location.href).toBe("https://client.example/thanks");
  });

  it("ignores a redirect message with a javascript: URL — does not navigate", () => {
    const { iframe, send, win } = run({ "data-form": "abc123def456" }, "https://client.example/");
    const before = win.top.location.href;
    send({ source: iframe.contentWindow, origin: ORIGIN,
           data: { type: "bis-form-redirect", url: "javascript:alert(1)" } });
    expect(win.top.location.href).toBe(before);
  });

  it("does nothing without a data-form attribute", () => {
    const { inserted } = run({}, "https://client.example/");
    expect(inserted).toHaveLength(0);
  });

  it("keeps two embeds on one host page isolated — a height message from the first iframe only resizes the first", () => {
    const { iframeA, iframeB, send } = runTwoEmbeds("https://client.example/");
    const beforeB = iframeB.style.height;

    send({ source: iframeA.contentWindow, origin: ORIGIN, data: { type: "bis-form-height", height: 900 } });

    expect(iframeA.style.height).toBe("900px");
    expect(iframeB.style.height).toBe(beforeB);
  });

  describe("data-booking (booking pages share the same embed script)", () => {
    it("injects an iframe pointing at the hosted booking page, defaulting min-height to 560", () => {
      const { iframe, inserted } = run({ "data-booking": "resource-42" }, "https://client.example/book");
      expect(inserted).toHaveLength(1);
      expect(iframe.src).toContain(`${ORIGIN}/b/resource-42`);
      expect(iframe.style.height).toBe("560px");
    });

    it("respects an explicit data-min-height instead of the 560 booking default", () => {
      const { iframe } = run(
        { "data-booking": "resource-42", "data-min-height": "700" },
        "https://client.example/book",
      );
      expect(iframe.style.height).toBe("700px");
    });

    it("prefers data-form over data-booking when a tag carries both (first-wins)", () => {
      const { iframe } = run(
        { "data-form": "form1", "data-booking": "booking1" },
        "https://client.example/",
      );
      expect(iframe.src).toContain(`${ORIGIN}/f/form1`);
      expect(iframe.src).not.toContain("/b/booking1");
    });

    it("lifts utm and click ids off the host page url for a booking embed too", () => {
      const { iframe } = run(
        { "data-booking": "resource-42" },
        "https://client.example/book?utm_source=google&utm_medium=cpc",
      );
      const url = new URL(iframe.src);
      expect(url.searchParams.get("utm_source")).toBe("google");
    });

    it("resizes a booking iframe on a height message from its own iframe", () => {
      const { iframe, send } = run({ "data-booking": "resource-42" }, "https://client.example/");
      send({ source: iframe.contentWindow, origin: ORIGIN, data: { type: "bis-form-height", height: 900 } });
      expect(iframe.style.height).toBe("900px");
    });

    it("ignores a redirect message with a javascript: URL on a booking embed — does not navigate", () => {
      const { iframe, send, win } = run({ "data-booking": "resource-42" }, "https://client.example/");
      const before = win.top.location.href;
      send({ source: iframe.contentWindow, origin: ORIGIN,
             data: { type: "bis-form-redirect", url: "javascript:alert(1)" } });
      expect(win.top.location.href).toBe(before);
    });

    it("defaults the booking iframe's title to \"Booking\", not the shared \"Form\" default (M1)", () => {
      const { iframe } = run({ "data-booking": "resource-42" }, "https://client.example/book");
      expect(iframe.title).toBe("Booking");
    });
  });
});
