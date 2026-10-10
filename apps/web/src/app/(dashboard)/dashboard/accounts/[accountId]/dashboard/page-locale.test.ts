import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8",
);

describe("dashboard KPI row resolves through the locale helper", () => {
  it("resolves locale through requestLocale with the account/isOperator shape, calls formatCurrency with a locale argument, and routes the KPI labels through t() (mutation: call formatCurrency(currentPipelineValue) with no second arg → FAILS)", () => {
    expect(src).toMatch(/requestLocale\(\{ account, isOperator: isAgency \}/);
    expect(src).toMatch(/formatCurrency\(currentPipelineValue, locale\)/);
    expect(src).toMatch(/t\(m, "dashboard\.kpi\.last7Days", locale\)/);
  });
});
