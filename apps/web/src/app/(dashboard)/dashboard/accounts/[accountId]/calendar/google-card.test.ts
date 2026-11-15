import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import type { GoogleCardView } from "./google-card-data";

/** S-22 slice 1, PR 3: the Google Calendar card, every state, in English and Spanish (what Disconnect does is in google-card-data.test.ts). */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { GoogleCard, GoogleCardSkeleton } = await import("./google-card");

const HREF = "/api/google-calendar/connect?account=acc1";
const link = { kind: "link", href: HREF } as const;
const v = (body: GoogleCardView["body"], outcome: GoogleCardView["outcome"] = null): GoogleCardView => ({ outcome, body });
const STATES: Record<string, GoogleCardView> = {
  error: v({ kind: "error" }),
  empty: v({ kind: "empty", connect: link }),
  emptyPaused: v({ kind: "empty", connect: { kind: "paused" } }),
  emptyWrongOrigin: v({ kind: "empty", connect: { kind: "wrongOrigin", origin: "https://app.bis-rgv.com" } }),
  connected: v({ kind: "connected", email: "dan@example.com", lastCheckedAt: new Date(Date.now() - 3600_000).toISOString() }),
  connectedNever: v({ kind: "connected", email: "dan@example.com", lastCheckedAt: null }),
  needsReconnect: v({ kind: "needsReconnect", email: "dan@example.com", connect: link }),
  needsReconnectPaused: v({ kind: "needsReconnect", email: "dan@example.com", connect: { kind: "paused" } }),
};
const disconnect = async () => ({ ok: true as const });
const render = (view: GoogleCardView, locale: Locale = "en", pseudo = false) =>
  renderToStaticMarkup(createElement(GoogleCard, { view, locale, pseudo, disconnect }));
const primaries = (html: string) => (html.match(/data-variant="default"/g) ?? []).length;
const text = (key: string, locale: Locale, p?: Record<string, string>) =>
  makeTr(locale).text(key as Parameters<ReturnType<typeof makeTr>["text"]>[0], p);

describe("GoogleCard", () => {
  const SENTENCE: Record<string, string> = {
    error: "calendar.google.loadError", empty: "calendar.google.empty", emptyPaused: "calendar.google.paused",
    emptyWrongOrigin: "calendar.google.empty", connected: "calendar.google.connected.note",
    connectedNever: "calendar.google.neverChecked", needsReconnect: "calendar.google.needsReconnect.body",
    needsReconnectPaused: "calendar.google.paused",
  };
  for (const locale of ["en", "es"] as const) {
    it.each(Object.keys(STATES))(`${locale}: %s says its sentence under the title`, (name) => {
      const t = renderedText(render(STATES[name]!, locale));
      expect(t).toContain(text("calendar.google.title", locale));
      expect(t).toContain(text(SENTENCE[name]!, locale));
    });
  }

  it("one primary per state, and none where nothing can be pressed (rule 8)", () => {
    const want: Record<string, number> = {
      error: 0, empty: 1, emptyPaused: 0, emptyWrongOrigin: 0, connected: 0, connectedNever: 0, needsReconnect: 1, needsReconnectPaused: 0,
    };
    for (const [name, n] of Object.entries(want)) expect(primaries(render(STATES[name]!)), name).toBe(n);
  });

  it("Connect and Reconnect are a plain anchor to the connect route", () => {
    for (const name of ["empty", "needsReconnect"]) {
      const html = render(STATES[name]!);
      expect(html, name).toContain(`<a href="${HREF}"`);
    }
  });

  it("a paused client sees no Connect link at all; a wrong origin names the address instead", () => {
    expect(render(STATES.emptyPaused!)).not.toContain("/api/google-calendar/connect");
    expect(render(STATES.needsReconnectPaused!)).not.toContain("/api/google-calendar/connect");
    const t = renderedText(render(STATES.emptyWrongOrigin!));
    expect(t).toContain("To connect, open this page at https://app.bis-rgv.com.");
    expect(render(STATES.emptyWrongOrigin!)).not.toContain("/api/google-calendar/connect");
  });

  it("status is dot + word: Connected with the email, Needs reconnecting, each with a dot", () => {
    const c = render(STATES.connected!);
    expect(renderedText(c)).toContain("Connected");
    expect(c).toMatch(/size-\[7px\][^>]*--good/);
    const n = render(STATES.needsReconnect!);
    expect(renderedText(n)).toContain("Needs reconnecting");
    expect(n).toMatch(/size-\[7px\][^>]*--crit/);
  });

  it("Disconnect is a ghost button on both connected states (rule 8)", () => {
    for (const name of ["connected", "needsReconnect", "connectedNever"]) {
      expect(render(STATES[name]!, "en"), name).toMatch(/<button[^>]*data-variant="ghost"[^>]*>Disconnect</);
    }
  });

  it("the outcome of the trip to Google is one status line, good for connected, warn otherwise", () => {
    const ok = render(v({ kind: "connected", email: "a@b.co", lastCheckedAt: null }, "connected"));
    expect(renderedText(ok)).toContain(text("calendar.google.outcome.connected", "en"));
    expect(ok).toContain("--good-bg");
    for (const o of ["denied", "failed", "paused"] as const) {
      const html = render(v({ kind: "empty", connect: link }, o), "es");
      expect(renderedText(html), o).toContain(text(`calendar.google.outcome.${o}`, "es"));
      expect(html, o).toContain("--warn-bg");
    }
    expect(render(STATES.empty!)).not.toContain("data-slot=\"notice\"");
    // M-3: a status line the reader did not ask for is polite, never an interrupting alert.
    expect(ok).toMatch(/data-slot="notice"[^>]*role="status"|role="status"[^>]*data-slot="notice"/);
    expect(ok).not.toContain('role="alert"');
  });

  it("a long email wraps on its own line instead of widening the pill (I-3)", () => {
    const email = "a.very.long.business.name.owner@example-company.com";
    for (const body of [
      { kind: "connected", email, lastCheckedAt: null } as const,
      { kind: "needsReconnect", email, connect: link } as const,
    ]) {
      const html = render(v(body));
      expect(html).toMatch(new RegExp(`<p[^>]*min-w-0[^>]*overflow-wrap:anywhere[^>]*>${email}</p>`));
      expect(html).not.toMatch(new RegExp(`whitespace-nowrap[^>]*>(<span[^>]*></span>)?[^<]*${email}`));
    }
    expect(renderedText(render(STATES.connected!))).toContain("Connected");
  });

  it("survives the pseudo-locale and marks the card for the palette", () => {
    const html = render(STATES.connected!, "en", true);
    expect(html).not.toContain("Disconnect<");
    expect(html).toMatch(/^<div(?=[^>]*\bid="google-calendar")(?=[^>]*\bdata-google-card)[^>]*>/);
  });

  it("no hard-coded colour in the markup", () => {
    for (const name of Object.keys(STATES)) expect(render(STATES[name]!), name).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it("the skeleton is shaped like the card and carries no copy", () => {
    const html = renderToStaticMarkup(createElement(GoogleCardSkeleton));
    expect(html).toContain("data-google-card-skeleton");
    expect(renderedText(html).trim()).toBe("");
  });
});
