import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { makeTr } from "@/lib/record/copy";
import { renderedText } from "@/lib/rendered-text";

const fx = vi.hoisted(() => ({
  fail: false,
  results: {
    said: { counted: 5, booked: 2, abandoned: 1, askedPerson: 1 },
    didnt: { counted: 3, booked: 0, abandoned: 3, askedPerson: 0 },
    notCounted: 6,
  },
}));

// importOriginal-based (not the Global Constraints' flagged bare-factory shape), overriding only what
// this card reads.
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => ({ tag: "service" }),
  getDisclosureResults: async (_db: unknown, accountId: string) => {
    if (fx.fail) throw new Error("boom");
    return { ...fx.results, accountId };
  },
}));

const { DisclosureResultsCard } = await import("./disclosure-results-card");

beforeEach(() => {
  fx.fail = false;
});

describe("DisclosureResultsCard", () => {
  it("renders the loaded view from a resolving read, with counted cells from it", async () => {
    const el = await DisclosureResultsCard({ accountId: "acct-1", tr: makeTr("en") });
    const html = renderToStaticMarkup(el);
    expect(renderedText(html)).toContain("Saying it's an AI: how calls went");
    expect(html).toMatch(/data-half="said"[\s\S]*?data-cell="counted"[^>]*>5</);
    expect(html).toMatch(/data-half="didnt"[\s\S]*?data-cell="counted"[^>]*>3</);
  });

  it("a failed read never rethrows: it logs the account id only and renders the error state (mutation: rethrow in the catch → FAILS)", async () => {
    fx.fail = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = await DisclosureResultsCard({ accountId: "acct-1", tr: makeTr("en") });
    const html = renderToStaticMarkup(el);
    expect(renderedText(html)).toContain("Couldn't load how calls went.");
    expect(errSpy).toHaveBeenCalledOnce();
    const line = String(errSpy.mock.calls[0]!.join(" "));
    expect(line).toContain("acct-1");
    // The thrown error's own class/message (loggableError) is fine to log; what must never
    // leak is the mock's RESULT data, which the catch never sees.
    expect(line).not.toContain("notCounted");
    expect(line).not.toContain("booked");
    errSpy.mockRestore();
  });
});
