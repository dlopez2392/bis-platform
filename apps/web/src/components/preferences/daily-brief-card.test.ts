import { describe, it, expect, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

import { DailyBriefCard, DailyBriefCardError, DailyBriefCardSkeleton } from "./daily-brief-card";

const noop = async () => ({ ok: true as const });
const html = (rows: Parameters<typeof DailyBriefCard>[0]["rows"], locale: "en" | "es" = "en") =>
  renderToStaticMarkup(h(DailyBriefCard, { rows, locale, pseudo: false, setBrief: noop }));

describe("DailyBriefCard states", () => {
  it("an off row: dot + the word Off, a switch named for the business, aria-checked false, no schedule line", () => {
    const out = html([{ accountId: "a1", businessName: "Rio Roofing", on: false, lastSentDay: null }]);
    expect(out).toContain('role="switch"');
    expect(out).toContain('aria-checked="false"');
    expect(out).toContain('aria-label="Daily brief for Rio Roofing"');
    expect(out).toContain(">Off<");
    expect(out).not.toContain("Arrives at 7 AM");
  });

  it("an on row with nothing sent yet says when the first one comes", () => {
    const out = html([{ accountId: "a1", businessName: "Rio Roofing", on: true, lastSentDay: null }]);
    expect(out).toContain('aria-checked="true"');
    expect(out).toContain(">On<");
    expect(out).toContain("Arrives at 7 AM, your time.");
    expect(out).toContain("First one tomorrow.");
  });

  it("an on row that has sent says which day the last one was, in the person's language", () => {
    const row = { accountId: "a1", businessName: "Rio Roofing", on: true, lastSentDay: "2026-11-17" };
    expect(html([row])).toContain("Last one: Tuesday, Nov 17.");
    expect(html([row], "es")).toContain("El último: martes, 17 de nov.");
    expect(html([row], "es")).toContain("Activado");
  });

  it("states the overdue-to-do consequence plainly in both languages", () => {
    expect(html([])).toContain("an overdue to-do that is never closed means one every morning");
    expect(html([], "es")).toContain("una tarea vencida que nunca se cierra significa uno cada mañana");
  });

  it("no eligible business: the empty state, no switch", () => {
    const out = html([]);
    expect(out).toContain("data-daily-brief-empty");
    expect(out).not.toContain('role="switch"');
  });

  it("error and loading states render, the loading one without any text to read", () => {
    expect(renderToStaticMarkup(h(DailyBriefCardError, { locale: "en", pseudo: false }))).toContain("Reload the page");
    expect(renderToStaticMarkup(h(DailyBriefCardSkeleton))).toContain('data-slot="skeleton"');
  });
});
