import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeTr } from "@/lib/record/copy";
import { buildSuggestionView } from "@/lib/proposals/view";
import { CALL_AT, FIVE, NAMES, NOW, PIPELINE_STAGES, STAGES, ZONE, rows } from "@/components/proposals/suggestion-specimens";
import { SuggestionDemo } from "./suggestion-demo";

const TRS = [["en", makeTr("en")], ["es", makeTr("es")], ["pseudo", makeTr("en", true)]] as const;
const columns = TRS.map(([key, tr]) => ({
  key, caption: key,
  views: [...FIVE, "aged" as const].map((s) => buildSuggestionView(rows[s], {
    tr, zone: ZONE, now: NOW, stages: STAGES, pipelineStages: PIPELINE_STAGES, callerName: "Ana López",
    callStartedAt: CALL_AT, personaName: "Sofía", names: NAMES, viewerId: null,
  })),
}));

describe("styleguide: the suggestion card", () => {
  it("shows the five states and the aged one in each of en, es and pseudo, plus Edit and accept's form", () => {
    const h = renderToStaticMarkup(createElement(SuggestionDemo, { columns }));
    for (const key of ["en", "es", "pseudo"]) {
      const col = h.split("data-sg-suggestions=\"").find((part) => part.startsWith(`${key}"`)) ?? "";
      expect([...col.matchAll(/<article[^>]*data-status="([a-z]+)"/g)].map((x) => x[1]))
        .toEqual(["pending", "accepted", "edited", "dismissed", "expired", "expired"]);
      expect(col).toMatch(/data-sg-suggestion-edit[\s\S]*<form[\s\S]*type="submit"/);
    }
    expect(h).toContain("Pendiente");
    expect(h).toMatch(/\[Sú/);
  });
});
