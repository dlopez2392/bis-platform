// apps/web/src/lib/owner-line/tools/schemas.test.ts
// F-023 PR 1: the owner line's three tools, byte for byte. The fixture was captured from main (f257e92f) BEFORE the
// tools moved onto the belt (lib/tools), one JSON.stringify per tool, so a change of a character, a key's order or an
// array's order in what the owner-line session sends OpenAI fails here.
import { describe, it, expect } from "vitest";
import { OWNER_TOOL_SCHEMAS } from "./schemas";
import { buildOwnerLineSessionConfig } from "../session-config";
import fixture from "./owner-tool-schemas.fixture.json";

describe("OWNER_TOOL_SCHEMAS (F-023: byte-identical across the move to the belt)", () => {
  it("serialises exactly as captured from main, tool by tool, key order included", () => {
    expect(OWNER_TOOL_SCHEMAS.map((s) => JSON.stringify(s))).toEqual(fixture);
  });

  it("is what the owner-line session sends, unchanged", () => {
    const tools = buildOwnerLineSessionConfig({ firstName: "Dan", locale: "en", businessName: "Rio Roofing",
      personaName: "Sofía", timezone: "America/Chicago", now: new Date("2026-11-09T21:00:00Z") }).tools;
    expect(JSON.stringify(tools)).toBe(`[${fixture.join(",")}]`);
  });
});
