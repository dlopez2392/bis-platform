import { describe, it, expect } from "vitest";
import { aiAppLogLine, aiAppsUseRows, mcpServerUrl } from "./view";
import { MCP_PATH } from "@/lib/mcp/auth";
import { AI_APP_LOG_KINDS, type AiAppsSwitchState } from "@bis/db";
import { m } from "@/lib/messages";

const mb = (accountId: string, role: string, businessName: string) =>
  ({ accountId, userId: "u-" + accountId, role, businessName, number: null }) as never;

describe("mcpServerUrl", () => {
  it("is the app origin plus the route PR B serves, never a doubled slash (mutation: change the path -> FAILS)", () => {
    expect(mcpServerUrl("https://app.bis-rgv.com")).toBe(`https://app.bis-rgv.com${MCP_PATH}`);
    expect(mcpServerUrl("https://app.bis-rgv.com/")).toBe("https://app.bis-rgv.com/api/mcp");
  });
  it("is null without an origin, so the card says so instead of showing a relative path", () => {
    expect(mcpServerUrl(null)).toBeNull();
  });
});

describe("aiAppLogLine", () => {
  const row = { who: "Ana Ruiz", kind: "ai_app_appointments" as const, at: "2026-11-19T20:30:00.000Z" };
  it("names who, the read in words and the time in the account's zone, in both languages (mutation: format in UTC -> FAILS)", () => {
    expect(aiAppLogLine(row, "en", "America/Chicago")).toEqual({ who: "Ana Ruiz", what: "read appointments", when: "Nov 19, 2:30 PM" });
    expect(aiAppLogLine(row, "es", "America/Chicago")).toMatchObject({ who: "Ana Ruiz", what: "leyó citas" });
  });
  it("a read with no stored name is 'Someone on the team', never blank (mutation: show the empty string -> FAILS)", () => {
    expect(aiAppLogLine({ ...row, who: null }, "en", "America/Chicago").who).toBe("Someone on the team");
    expect(aiAppLogLine({ ...row, who: "  " }, "es", "America/Chicago").who).toBe("Alguien del equipo");
  });
  it("every kind the log can hold has words in both languages (mutation: drop one kind's key -> FAILS)", () => {
    for (const kind of AI_APP_LOG_KINDS) {
      expect(m[`aiApps.log.${kind}` as keyof typeof m], kind).toBeTruthy();
      expect(m[`aiApps.log.${kind}.es` as keyof typeof m], kind).toBeTruthy();
    }
  });
});

describe("aiAppsUseRows", () => {
  const on: AiAppsSwitchState = { enabledAt: "2026-11-19T20:00:00.000Z", changedAt: null, changedBy: null };
  const off: AiAppsSwitchState = { enabledAt: null, changedAt: null, changedBy: null };
  it("lists Owner and Staff businesses only, with their switch, sorted by name (mutation: include Technician -> FAILS)", () => {
    const rows = aiAppsUseRows(
      [mb("b", "staff", "Zeta Co"), mb("t", "technician", "Tech Co"), mb("a", "owner", "Alpha Co")],
      new Map([["a", on], ["b", off], ["t", on]]),
    );
    expect(rows).toEqual([
      { accountId: "a", businessName: "Alpha Co", role: "owner", state: "on" },
      { accountId: "b", businessName: "Zeta Co", role: "staff", state: "off" },
    ]);
  });
  it("a business whose switch could not be read says so, never 'off' (mutation: treat a missing read as off -> FAILS)", () => {
    expect(aiAppsUseRows([mb("a", "owner", "Alpha Co")], new Map())[0]!.state).toBe("unknown");
  });
  it("a person with only a Technician membership gets no rows", () => {
    expect(aiAppsUseRows([mb("t", "technician", "Tech Co")], new Map([["t", on]]))).toEqual([]);
  });
});
