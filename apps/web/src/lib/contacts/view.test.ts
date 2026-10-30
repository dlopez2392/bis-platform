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

  // F-006 part 1 (plan Task 10): `?view=duplicates` is the Possible duplicates view.
  it("only the exact word 'duplicates' is the duplicates view (mutation: fold it into 'archived' -> FAILS)", () => {
    expect(parseView("duplicates")).toBe("duplicates");
    expect(parseView("Duplicates")).toBe("active");
  });
});

describe("withView", () => {
  it("adds view=archived in the Archived view, and nothing in the list", () => {
    expect(withView({ sort: "name" }, "archived")).toEqual({ sort: "name", view: "archived" });
    expect(withView({ sort: "name" }, "active")).toEqual({ sort: "name" });
  });
  it("adds view=duplicates in the duplicates view (mutation: drop it -> FAILS; paging would lose the view)", () => {
    expect(withView({ sort: "name" }, "duplicates")).toEqual({ sort: "name", view: "duplicates" });
  });
});

describe("archivedFilterOf", () => {
  it("the Archived view reads only archived contacts; the list and the duplicates view leave them out", () => {
    expect(archivedFilterOf("archived")).toBe("only");
    expect(archivedFilterOf("active")).toBe("exclude");
    expect(archivedFilterOf("duplicates")).toBe("exclude");
  });
});
