import { describe, it, expect, vi, afterEach } from "vitest";
import { searchHeldContacts, localizeHit } from "./held-email-search";
import { m } from "@/lib/messages";

const controller = () => new AbortController();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchHeldContacts", () => {
  it("ok: localizes every hit's label, passes sublabel through, and answers the query the hits answered (mutation: drop sublabel -> FAILS)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ contacts: [{ id: "c1", label: "Unnamed contact", sublabel: "ana@example.com" }, { id: "c2", label: "Pat Nguyen", sublabel: "555-1234" }] }),
    })));
    const r = await searchHeldContacts("a1", "an", "es", controller().signal);
    expect(r).toEqual({ status: "ok", query: "an", hits: [
      { id: "c1", label: m["contact.noName.es"], sublabel: "ana@example.com" },
      { id: "c2", label: "Pat Nguyen", sublabel: "555-1234" },
    ] });
  });

  it("asks the palette's own GET route for contacts only, with the term encoded (F-092 part 1, plan Task 10; mutation: drop &types=contacts -> FAILS)", async () => {
    const fetchSpy = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ contacts: [] }) }));
    vi.stubGlobal("fetch", fetchSpy);
    await searchHeldContacts("a1", "garcía maria", "en", controller().signal);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/accounts/a1/search?q=garc%C3%ADa%20maria&types=contacts");
  });

  it("a non-ok response answers error, never empty hits (mutation: answer ok with [] -> FAILS)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await searchHeldContacts("a1", "an", "en", controller().signal)).toEqual({ status: "error" });
  });

  it("a network throw other than abort propagates (the caller's own catch turns it into 'error') (mutation: swallow it here into ok -> FAILS)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(searchHeldContacts("a1", "an", "en", controller().signal)).rejects.toThrow("network down");
  });
});

describe("localizeHit", () => {
  it("replaces the search route's own 'Unnamed contact' literal with contact.noName (mutation: compare against a different literal -> FAILS)", () => {
    expect(localizeHit({ id: "c1", label: "Unnamed contact", sublabel: null }, "en")).toEqual({ id: "c1", label: m["contact.noName"], sublabel: null });
  });

  it("leaves a real name untouched", () => {
    expect(localizeHit({ id: "c1", label: "Ana Ruiz", sublabel: "ana@example.com" }, "es")).toEqual({ id: "c1", label: "Ana Ruiz", sublabel: "ana@example.com" });
  });
});
