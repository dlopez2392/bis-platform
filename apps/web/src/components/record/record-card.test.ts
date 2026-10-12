import { describe, it, expect, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { RecordCard, RecordCardView } = await import("./record-card");
const { m } = await import("@/lib/messages");

const view = (over: Partial<ComponentProps<typeof RecordCardView>> = {}, children: unknown = null) =>
  renderToStaticMarkup(createElement(RecordCardView, {
    id: "deals", title: "Deals", state: "ready", skeletonRows: 2, errorText: "Couldn't load Deals.",
    retryLabel: "Try again", showLabel: "Show Deals", disclosure: false, open: false, onToggle: () => {},
    ...over,
  }, children as never));

describe("RecordCard (spec §8): one chrome, its own states, a phone disclosure", () => {
  it("a closed phone card shows its title as a disclosure and mounts no body, so it fetches nothing (mutation: render the body hidden instead of not mounting it -> the body renders, FAILS)", () => {
    const body = vi.fn(() => createElement("p", null, "deal rows"));
    const html = view({ disclosure: true, open: false }, createElement(body));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Show Deals"');
    expect(body).not.toHaveBeenCalled();
    expect(html).not.toContain("deal rows");
  });

  it("an open disclosure says so and mounts the body (mutation: hard-code aria-expanded false -> FAILS)", () => {
    const html = view({ disclosure: true, open: true }, createElement("p", null, "deal rows"));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("deal rows");
  });

  it("a closed disclosure names no aria-controls, and an open one points at the body it mounts, so the link never dangles (mutation: unconditional aria-controls -> FAILS)", () => {
    const closed = view({ disclosure: true, open: false }, createElement("p", null, "deal rows"));
    expect(closed).not.toContain("aria-controls");
    const open = view({ disclosure: true, open: true }, createElement("p", null, "deal rows"));
    const target = open.match(/aria-controls="([^"]+)"/)?.[1];
    expect(target).toBeTruthy();
    expect(open).toContain(`id="${target}"`);
  });

  it("not a disclosure: a plain title and the body (desk, or a card that never collapses)", () => {
    const html = view({}, createElement("p", null, "deal rows"));
    expect(html).not.toContain("aria-expanded");
    expect(html).toMatch(/<h2[^>]*>.*Deals/);
    expect(html).toContain("deal rows");
  });

  it("loading is a skeleton shaped like rows, never a spinner (rule 7)", () => {
    const html = view({ state: "loading" }, createElement("p", null, "deal rows"));
    expect(html.match(/data-slot="skeleton"/g)).toHaveLength(2);
    expect(html).not.toContain("deal rows");
    expect(html).not.toMatch(/animate-spin/);
  });

  it("error is the card's own sentence and Try again, the body not rendered (mutation: render children on error -> FAILS)", () => {
    const html = view({ state: "error" }, createElement("p", null, "deal rows"));
    expect(html).toContain("Couldn&#x27;t load Deals.");
    expect(html).toContain(">Try again<");
    expect(html).not.toContain("deal rows");
  });

  it("a card's failure is announced as an alert, the repo's error role, never a status (mutation: role=\"status\" on RecordCardError -> FAILS)", () => {
    const html = view({ state: "error" });
    expect(html).toMatch(/role="alert"[^>]*data-record-error|data-record-error[^>]*role="alert"/);
    expect(html).not.toContain('role="status"');
  });

  it("RecordCard on the server: a collapsible card renders closed (phone-first), a fixed one open (mutation: server snapshot false -> the collapsible body renders, FAILS)", () => {
    const body = vi.fn(() => createElement("p", null, "body"));
    const closed = renderToStaticMarkup(createElement(RecordCard, { id: "groups", title: "Groups", collapsibleOnPhone: true }, createElement(body)));
    expect(closed).toContain('aria-expanded="false"');
    expect(body).not.toHaveBeenCalled();
    const open = renderToStaticMarkup(createElement(RecordCard, { id: "details", title: "Details" }, createElement("p", null, "fields")));
    expect(open).toContain('data-record-card="details"');
    expect(open).not.toContain("aria-expanded");
    expect(open).toContain("fields");
  });

  it("RecordCard's own words come from the catalogue: the default error names the card", () => {
    const html = renderToStaticMarkup(createElement(RecordCard, { id: "deals", title: "Deals", state: "error" }));
    expect(html).toContain(m["record.card.failed"].replace("{title}", "Deals").replace("'", "&#x27;"));
    expect(html).toContain(`>${m["record.card.retry"]}<`);
  });
});
