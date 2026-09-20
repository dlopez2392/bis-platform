/* eslint-disable @typescript-eslint/no-explicit-any -- hand-built DOM fakes
   need loose typing to stand in for window/document/iframe; this file is not
   part of the shipped script and typing it strictly would fight the fakes
   rather than catch a real bug. */
import { describe, it, expect } from "vitest";
import { EMBED_SCRIPT } from "./embed-script";

type Listener = (event: any) => void;

/**
 * A tag-aware element fake. The original single-iframe stand-in
 * (`createElement: () => iframe`) can't represent the concierge branch,
 * which creates a button and a panel div alongside the iframe — so every
 * element `document.createElement` hands out now tracks its own tag,
 * style, attributes and listeners, and `run()` exposes the full list as
 * `created` (plus `iframe`, kept as the first `<iframe>` for every existing
 * test that destructures it directly).
 */
function makeElement(tag: string) {
  const el: any = {
    tag,
    style: {},
    listeners: {} as Record<string, Listener[]>,
    setAttribute(k: string, v: string) { el[k] = v; },
    getAttribute(k: string) { return el[k] ?? null; },
    appendChild() { /* not asserted on; presence is enough */ },
    addEventListener(type: string, fn: Listener) {
      (el.listeners[type] ??= []).push(fn);
    },
  };
  if (tag === "iframe") el.contentWindow = { id: "iframe-window" };
  return el;
}

/** Minimal DOM good enough for the embed script, so the real string can run. */
function run(attrs: Record<string, string>, hostUrl: string, referrer = "") {
  const created: any[] = [];
  const bodyAppended: any[] = [];
  let messageListener: Listener | undefined;
  const keydownListeners: Listener[] = [];
  const inserted: any[] = [];

  const script = {
    src: "https://platform.example.com/embed.js",
    getAttribute: (name: string) => attrs[name] ?? null,
    parentNode: { insertBefore: (node: any) => inserted.push(node) },
    nextSibling: null,
  };

  const document = {
    currentScript: script,
    referrer,
    body: { appendChild: (el: any) => bodyAppended.push(el) },
    createElement: (tag: string) => { const el = makeElement(tag); created.push(el); return el; },
  };
  const win: any = {
    location: { search: new URL(hostUrl).search, href: hostUrl },
    addEventListener: (type: string, fn: Listener) => {
      if (type === "message") messageListener = fn;
      if (type === "keydown") keydownListeners.push(fn);
    },
    top: { location: { href: "" } },
  };
  win.parent = win;

  new Function("window", "document", "URL", "URLSearchParams", EMBED_SCRIPT)(
    win, document, URL, URLSearchParams);

  const iframe = created.find((el) => el.tag === "iframe");
  return {
    iframe, inserted, win, created, bodyAppended,
    send: (event: any) => messageListener?.(event),
    keydown: (event: any) => keydownListeners.forEach((fn) => fn(event)),
  };
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

  it("forwards the host page's own colour mode from data-theme, and only the two real values", () => {
    const dark = run({ "data-form": "abc123def456", "data-theme": "dark" }, "https://client.example/");
    expect(new URL(dark.iframe.src).searchParams.get("theme")).toBe("dark");

    const light = run({ "data-booking": "resource-42", "data-theme": "light" }, "https://client.example/");
    expect(new URL(light.iframe.src).searchParams.get("theme")).toBe("light");

    // A value that is not a mode is not a hint — never forwarded as-is.
    const junk = run({ "data-form": "abc123def456", "data-theme": "auto" }, "https://client.example/");
    expect(new URL(junk.iframe.src).searchParams.get("theme")).toBeNull();

    const none = run({ "data-form": "abc123def456" }, "https://client.example/");
    expect(new URL(none.iframe.src).searchParams.get("theme")).toBeNull();
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

  describe("data-concierge (the floating bubble)", () => {
    function panelOf(created: any[]) {
      return created.find((el) => el.tag === "div" && el.style.position === "fixed");
    }
    function launcherOf(created: any[]) {
      return created.find((el) => el.tag === "button");
    }

    it("builds a launcher and a panel instead of an inline iframe, pointing the iframe at /c/", () => {
      const { created, iframe } = run({ "data-concierge": "abc123" }, "https://client.example/");
      expect(launcherOf(created)).toBeTruthy();
      expect(panelOf(created)).toBeTruthy();
      expect(iframe.src).toContain(`${ORIGIN}/c/abc123`);
    });

    it("starts closed", () => {
      const { created } = run({ "data-concierge": "abc123" }, "https://client.example/");
      const panel = panelOf(created);
      // MUTATION: render the panel open — this FAILS, and every visitor to
      // every client's site gets a chat shoved in front of them.
      expect(panel.style.display).toBe("none");
    });

    it("sets the iframe's src at load, before any click — the fill floor has time to pass", () => {
      // No click happens anywhere in this test. If src were assigned inside
      // the launcher's click handler instead of up front, this iframe would
      // have no src at all yet.
      const { created, iframe } = run({ "data-concierge": "abc123" }, "https://client.example/");
      expect(panelOf(created).style.display).toBe("none");
      expect(iframe.src).toContain("/c/abc123");
    });

    it("still passes attribution through, as the form branch does", () => {
      const { iframe } = run({ "data-concierge": "abc123" }, "https://client.example/?utm_source=google");
      expect(iframe.src).toContain("utm_source=google");
    });

    it("leaves data-form and data-booking behaviour byte-identical", () => {
      // MUTATION: route data-form down the concierge branch — this FAILS.
      expect(run({ "data-form": "f1" }, "https://client.example/").iframe.src).toContain("/f/f1");
      expect(run({ "data-booking": "b1" }, "https://client.example/").iframe.src).toContain("/b/b1");
    });

    it("toggles the panel open and closed on launcher click, tracking aria-expanded", () => {
      const { created } = run({ "data-concierge": "abc123" }, "https://client.example/");
      const panel = panelOf(created);
      const launcher = launcherOf(created);
      expect(launcher.getAttribute("aria-expanded")).toBe("false");

      launcher.listeners.click[0]({});
      expect(panel.style.display).toBe("block");
      expect(launcher.getAttribute("aria-expanded")).toBe("true");

      launcher.listeners.click[0]({});
      expect(panel.style.display).toBe("none");
      expect(launcher.getAttribute("aria-expanded")).toBe("false");
    });

    it("gives the launcher an aria-label", () => {
      const { created } = run({ "data-concierge": "abc123" }, "https://client.example/");
      expect(launcherOf(created).getAttribute("aria-label")).toBeTruthy();
    });

    it("closes the panel on Escape, even though the panel is the host page's overlay", () => {
      const { created, keydown } = run({ "data-concierge": "abc123" }, "https://client.example/");
      const panel = panelOf(created);
      const launcher = launcherOf(created);
      launcher.listeners.click[0]({});
      expect(panel.style.display).toBe("block");

      keydown({ key: "Escape" });
      expect(panel.style.display).toBe("none");
    });

    it("keeps BOTH postMessage checks on the concierge close message", () => {
      const { created, send, iframe } = run({ "data-concierge": "abc123" }, "https://client.example/");
      const panel = panelOf(created);
      const launcher = launcherOf(created);
      launcher.listeners.click[0]({});
      expect(panel.style.display).toBe("block");

      // Right source, wrong origin — must NOT close.
      send({ source: iframe.contentWindow, origin: "https://evil.example", data: { type: "bis-concierge-close" } });
      expect(panel.style.display).toBe("block");

      // Wrong source, right origin — must NOT close.
      send({ source: {}, origin: ORIGIN, data: { type: "bis-concierge-close" } });
      expect(panel.style.display).toBe("block");

      // Right source AND origin — closes.
      send({ source: iframe.contentWindow, origin: ORIGIN, data: { type: "bis-concierge-close" } });
      expect(panel.style.display).toBe("none");
    });
  });
});
