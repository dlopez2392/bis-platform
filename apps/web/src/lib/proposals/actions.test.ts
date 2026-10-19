import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The four suggestion actions (item 8b-1, Task 6), unit-tested with every collaborator mocked: who is
 * asked first, which client goes where, what of a posted edit reaches the decision, which pages are
 * revalidated, which language the answer is in, and that the test seam never leaves this file. The
 * decisions themselves are proven live in decide.live.test.ts.
 */

const order = vi.hoisted(() => [] as string[]);
const access = vi.hoisted(() => ({ value: { userId: "u1", isAgency: true, role: null, canManage: true } as Record<string, unknown> }));
const prefs = vi.hoisted(() => ({ value: { language: null, theme: null } as { language: "en" | "es" | null; theme: null } }));
const accountRow = vi.hoisted(() => ({ value: { timezone: "America/Chicago", language: "en" } as { timezone: string; language: "en" | "es" | null } | null }));

const REQUEST = vi.hoisted(() => ({
  tag: "request",
  from: (table: string) => {
    order.push(`from:${table}`);
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: accountRow.value, error: null }) }) }) };
  },
}));
const SERVICE = vi.hoisted(() => ({ tag: "service" }));

vi.mock("@/lib/auth", () => ({
  requireAccountAccess: vi.fn(async () => { order.push("requireAccountAccess"); return access.value; }),
}));
vi.mock("@/lib/db", () => ({ dbForRequest: vi.fn(async () => { order.push("dbForRequest"); return REQUEST; }) }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: vi.fn(async () => { order.push("getPersonPrefs"); return prefs.value; }) }));
vi.mock("@bis/db", async (io) => ({
  ...(await io<typeof import("@bis/db")>()),
  serviceDb: () => { order.push("serviceDb"); return SERVICE; },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./decide", async (io) => {
  const actual = await io<typeof import("./decide")>();
  const answer = (name: string) => vi.fn(async () => {
    order.push(name);
    return { ok: true, status: "accepted", toast: "Added to your to-do list", target: { callId: "c1", contactId: "k1" } };
  });
  return {
    ...actual,
    acceptSuggestion: answer("acceptSuggestion"),
    discardSuggestion: answer("discardSuggestion"),
    undoSuggestion: answer("undoSuggestion"),
  };
});

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import * as decide from "./decide";
import type { DecideDeps } from "./decide";
import {
  acceptSuggestionAction, editAcceptSuggestionAction, discardSuggestionAction, undoSuggestionAction,
} from "./actions";

const ACTIONS = [
  ["acceptSuggestionAction", () => acceptSuggestionAction("A", "p1"), decide.acceptSuggestion, ["p1"]],
  ["editAcceptSuggestionAction", () => editAcceptSuggestionAction("A", "p1", { value: "956 555 0101" }), decide.acceptSuggestion, ["p1", { value: "956 555 0101" }]],
  ["discardSuggestionAction", () => discardSuggestionAction("A", "p1"), decide.discardSuggestion, ["p1"]],
  ["undoSuggestionAction", () => undoSuggestionAction("A", "p1"), decide.undoSuggestion, ["p1"]],
] as const;

/** The deps object the action handed the decision on its last call. */
const depsOf = (spy: unknown): DecideDeps => vi.mocked(spy as typeof decide.acceptSuggestion).mock.calls.at(-1)![0];

beforeEach(() => {
  order.length = 0;
  access.value = { userId: "u1", isAgency: true, role: null, canManage: true };
  prefs.value = { language: null, theme: null };
  accountRow.value = { timezone: "America/Chicago", language: "en" };
  vi.mocked(revalidatePath).mockReset();
  for (const [, , spy] of ACTIONS) vi.mocked(spy).mockClear();
});

describe.each(ACTIONS)("%s", (name, run, spy, args) => {
  it("asks requireAccountAccess before anything else, then the request client, the account, the person, the service client " +
    "(mutation: requireAccountAccess after dbForRequest -> FAILS)", async () => {
    await run();
    expect(order).toEqual(["requireAccountAccess", "dbForRequest", "from:accounts", "getPersonPrefs", "serviceDb", name.replace("Action", "").replace("editAccept", "accept")]);
    expect(vi.mocked(requireAccountAccess)).toHaveBeenCalledWith("A");
  });

  it("hands the decision the REQUEST client as db and the SERVICE client as writer (mutation: swap them -> FAILS)", async () => {
    await run();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ db: REQUEST, writer: SERVICE, accountId: "A", userId: "u1", zone: "America/Chicago" }), ...args);
  });

  it("never sets the test seam: the deps carry EXACTLY seven keys (plan fix M7; mutation: pass afterRead -> FAILS)", async () => {
    await run();
    expect(Object.keys(depsOf(spy)).sort()).toEqual(["accountId", "db", "now", "tr", "userId", "writer", "zone"]);
  });

  it("on success revalidates exactly revalidateFor's pages, read off the decided row, and answers without the target " +
    "(mutation: drop the record page from revalidateFor -> FAILS)", async () => {
    const r = await run();
    expect(vi.mocked(revalidatePath).mock.calls.map((c) => c[0])).toEqual([
      "/dashboard/accounts/A/calls/c1", "/dashboard/accounts/A/tasks", "/dashboard/work", "/dashboard/accounts/A/contacts/k1",
    ]);
    // Every spy answers the same ok shape; what matters is that the target is stripped, whatever the action.
    expect(r).toEqual({ ok: true, status: "accepted", toast: "Added to your to-do list" });
  });

  it("a revalidatePath throw after the decision still answers ok", async () => {
    vi.mocked(revalidatePath).mockImplementation(() => { throw new Error("boom"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await run()).toMatchObject({ ok: true });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledTimes(4);
  });

  it("a refusal is passed through and revalidates nothing", async () => {
    vi.mocked(spy).mockResolvedValueOnce({ ok: false, error: "This suggestion isn't available." });
    expect(await run()).toEqual({ ok: false, error: "This suggestion isn't available." });
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  it("an unexpected throw answers the clean failure in the reader's language, and is logged", async () => {
    vi.mocked(spy).mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await run()).toEqual({ ok: false, error: "That didn't go through. Try again." });
    access.value = { userId: "u2", isAgency: false, role: "owner", canManage: true };
    prefs.value = { language: "es", theme: null };
    vi.mocked(spy).mockRejectedValueOnce(new Error("db down"));
    expect(await run()).toEqual({ ok: false, error: "No se guardó. Inténtelo otra vez." });
    expect(err.mock.calls.some((c) => String(c[0]).includes("p1"))).toBe(true);
  });

  it("a redirect from requireAccountAccess is not swallowed", async () => {
    vi.mocked(requireAccountAccess).mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(run()).rejects.toThrow("NEXT_REDIRECT");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("editAcceptSuggestionAction", () => {
  it("passes only title, dueAt, value and toStageId, and only as strings: a posted field never reaches the decision " +
    "(mutation: pass the whole object -> FAILS)", async () => {
    await editAcceptSuggestionAction("A", "p1", {
      title: "Call back", dueAt: "2026-10-21", value: "956 555 0101", toStageId: "s2",
      field: "email", opportunityId: "o9", fromStageId: "s0",
    });
    expect(vi.mocked(decide.acceptSuggestion).mock.calls.at(-1)![2]).toEqual({ title: "Call back", dueAt: "2026-10-21", value: "956 555 0101", toStageId: "s2" });
    await editAcceptSuggestionAction("A", "p1", { title: 5, value: null } as unknown as Record<string, string>);
    expect(vi.mocked(decide.acceptSuggestion).mock.calls.at(-1)![2]).toEqual({});
  });
});

describe("the answers follow the reader's stored language (plan fix M14)", () => {
  it("a client whose users.language is es gets Spanish, over the account's English", async () => {
    access.value = { userId: "u2", isAgency: false, role: "owner", canManage: true };
    prefs.value = { language: "es", theme: null };
    await acceptSuggestionAction("A", "p1");
    const { tr } = depsOf(decide.acceptSuggestion);
    expect(tr.locale).toBe("es");
    expect(tr.text("suggestions.accept")).toBe("Aceptar");
  });

  it("a client with no choice of their own gets the account's language; the agency with none gets English", async () => {
    access.value = { userId: "u2", isAgency: false, role: "owner", canManage: true };
    accountRow.value = { timezone: "America/Chicago", language: "es" };
    await acceptSuggestionAction("A", "p1");
    expect(depsOf(decide.acceptSuggestion).tr.locale).toBe("es");
    access.value = { userId: "u1", isAgency: true, role: null, canManage: true };
    await acceptSuggestionAction("A", "p1");
    expect(depsOf(decide.acceptSuggestion).tr.text("suggestions.accept")).toBe("Accept");
  });

  it("the account's own zone reaches the decision", async () => {
    accountRow.value = { timezone: "Asia/Beirut", language: "en" };
    await acceptSuggestionAction("A", "p1");
    expect(depsOf(decide.acceptSuggestion).zone).toBe("Asia/Beirut");
  });
});
