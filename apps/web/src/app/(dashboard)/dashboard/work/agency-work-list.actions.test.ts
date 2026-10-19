import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgencySuggestionData } from "@/components/proposals/suggestion-section";
import { makeTr } from "@/lib/record/copy";

/**
 * Each account's cards on the agency Work page decide through actions bound to THAT account (item 8b-2,
 * spec 5.2; plan fix I-3: `.bind(null, accountId)`, never a closure). The actions are recorded, never run
 * against a database, and the section is captured so each account's own four functions can be called.
 */
const calls = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/lib/proposals/actions", () => ({
  acceptSuggestionAction: async (...a: unknown[]) => { calls.push(["accept", ...a]); return { ok: true }; },
  editAcceptSuggestionAction: async (...a: unknown[]) => { calls.push(["editAccept", ...a]); return { ok: true }; },
  discardSuggestionAction: async (...a: unknown[]) => { calls.push(["discard", ...a]); return { ok: true }; },
  undoSuggestionAction: async (...a: unknown[]) => { calls.push(["undo", ...a]); return { ok: true }; },
}));
const seen = vi.hoisted(() => ({ data: null as AgencySuggestionData | null }));
vi.mock("@/components/proposals/suggestion-section", () => ({
  AgencySuggestionSection: ({ data }: { data: AgencySuggestionData }) => { seen.data = data; return null; },
}));

const { AgencyWorkList } = await import("./agency-work-list");

describe("AgencyWorkList binds each account's actions to that account", () => {
  it("account A's accept, edit, discard and undo reach the server with A's id, and B's with B's (mutation: bind every account to the first one's id -> FAILS)", async () => {
    const acct = (accountId: string) => ({ accountId, brandName: accountId, personaName: "Sofía", capped: false, groups: [] });
    renderToStaticMarkup(createElement(AgencyWorkList, {
      buckets: { overdue: [], today: [], waiting: [] }, contactNames: {}, tr: makeTr("en"),
      suggestions: { ok: true, accounts: [acct("acct-a"), acct("acct-b")] },
    }));
    expect(seen.data?.ok).toBe(true);
    const accounts = seen.data!.ok ? seen.data!.accounts : [];
    calls.length = 0;
    for (const a of accounts) {
      await a.actions.accept("sg-1");
      await a.actions.editAccept("sg-1", { title: "x" });
      await a.actions.discard("sg-1");
      await a.actions.undo("sg-1");
    }
    expect(calls).toEqual([
      ["accept", "acct-a", "sg-1"], ["editAccept", "acct-a", "sg-1", { title: "x" }],
      ["discard", "acct-a", "sg-1"], ["undo", "acct-a", "sg-1"],
      ["accept", "acct-b", "sg-1"], ["editAccept", "acct-b", "sg-1", { title: "x" }],
      ["discard", "acct-b", "sg-1"], ["undo", "acct-b", "sg-1"],
    ]);
  });
});
