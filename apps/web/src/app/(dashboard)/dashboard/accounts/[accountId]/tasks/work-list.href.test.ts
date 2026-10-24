import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeTr } from "@/lib/record/copy";
import type { WorkRow } from "@bis/db";

vi.mock("./actions", () => ({
  completeWorkTask: vi.fn(), reopenWorkTask: vi.fn(), dismissToTask: vi.fn(), closeOutBooking: vi.fn(),
  confirmStopFromTask: vi.fn(), notAStopFromTask: vi.fn(), undoHoldDecisionFromTask: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { WorkList } = await import("./work-list");

/** S-07 3a: both work queues link a row through workRowHref, so an expiry To-do opens its file (plan deviation 5). */
function stripComments(src: string): string {
  let out = "";
  let mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; i++; continue; }
      if (c === "/" && d === "*") { mode = "block"; i++; continue; }
      if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      out += c;
      continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } continue; }
    if (mode === "block") {
      if (c === "*" && d === "/") { mode = "code"; i++; } else if (c === "\n") out += c;
      continue;
    }
    if (c === "\\") { out += c + (d ?? ""); i++; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) mode = "code";
    out += c;
  }
  return out;
}
const AGENCY = path.resolve(__dirname, "../../../work/agency-work-list.tsx");

describe("the work queues' row links", () => {
  it("the agency list's path resolves (a wrong path must fail, never skip)", () => {
    expect(existsSync(AGENCY)).toBe(true);
  });
  it.each([
    [path.resolve(__dirname, "work-list.tsx"), "workRowHref(accountId, row)"],
    [AGENCY, "workRowHref(row.accountId, row)"],
  ])("%s builds its link with %s, never the bare contact href (mutation: restore the template literal -> FAILS)", (file, call) => {
    const src = stripComments(readFileSync(file, "utf8"));
    expect(src).toContain(call);
    expect(src).not.toMatch(/href=\{`\/dashboard\/accounts\/\$\{(?:accountId|row\.accountId)\}\/contacts\/\$\{row\.contactId\}`\}/);
  });
});

describe("the closure To-do's row (S-47d Task 7)", () => {
  it("a contact-less status To-do renders data-work-row-link as an <a> with workRowHref's own href (mutation: render a plain div for a closure row -> FAILS)", () => {
    const row: WorkRow = {
      id: "task:t1", source: "task", accountId: "a1", contactId: null,
      title: "Contact customers affected by the closure", dueAt: null, occurredAt: "2026-12-24T10:00:00Z",
      closureFocus: { kind: "status", on: "2026-12-24" },
    };
    const out = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [row], waiting: [] }, accountId: "a1", contactNames: {}, timezone: "America/Chicago",
      tr: makeTr("en"),
    }));
    expect(out).toMatch(/<a\b[^>]*data-work-row-link/);
    expect(out).toContain('href="/dashboard/accounts/a1/dashboard#business-status"');
  });
});
