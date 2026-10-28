import { describe, expect, it } from "vitest";
import { archivedFilterOf, parseView, withView } from "./view";

// Contact archive (plan Task 10): `?view=archived` is the Archived view of the contacts list. Every
// link the list builds carries it, so paging, sorting or searching the Archived view stays in it.
describe("parseView", () => {
  it("only the exact word 'archived' is the Archived view (mutation: any truthy value -> FAILS)", () => {
    expect(parseView("archived")).toBe("archived");
    expect(parseView("x")).toBe("active");
    expect(parseView("Archived")).toBe("active");
    expect(parseView(undefined)).toBe("active");
    expect(parseView("")).toBe("active");
    // A duplicated query key arrives as an array at runtime: never the Archived view.
    expect(parseView(["archived", "archived"])).toBe("active");
  });
});

describe("withView", () => {
  it("adds view=archived in the Archived view, and nothing in the list", () => {
    expect(withView({ sort: "name" }, "archived")).toEqual({ sort: "name", view: "archived" });
    expect(withView({ sort: "name" }, "active")).toEqual({ sort: "name" });
  });
});

describe("archivedFilterOf", () => {
  it("the Archived view reads only archived contacts; the list leaves them out", () => {
    expect(archivedFilterOf("archived")).toBe("only");
    expect(archivedFilterOf("active")).toBe("exclude");
  });
});
