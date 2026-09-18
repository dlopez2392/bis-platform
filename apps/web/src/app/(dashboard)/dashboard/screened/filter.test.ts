import { describe, it, expect } from "vitest";
import { parseScreenedClass } from "./filter";

describe("parseScreenedClass", () => {
  it("accepts each real class, derived from screenedClass over every reason (mutation: collapse every reason into one class -> FAILS)", () => {
    expect(parseScreenedClass("misconfigured")).toBe("misconfigured");
    expect(parseScreenedClass("screened")).toBe("screened");
    expect(parseScreenedClass("unattributed")).toBe("unattributed");
  });

  // `?class=` is a hand-editable URL parameter, same as `?before=`
  // (`parseTimeCursor`, `@/lib/cursor` — the house precedent this follows):
  // missing, empty, or misspelled must all read as "no filter" rather than a
  // 500 or a page that silently renders everything while its own header
  // claims to be scoped. One mutation (the final fallback hard-coding a
  // class) breaks all three at once, which is itself the point — there is no
  // "default" class, only "no filter".
  it("reads absent, empty, and unknown values as no filter, never a default class (mutation: fall back to 'misconfigured' instead of undefined -> FAILS)", () => {
    expect(parseScreenedClass(undefined)).toBeUndefined();
    expect(parseScreenedClass("")).toBeUndefined();
    expect(parseScreenedClass("bogus")).toBeUndefined();
  });

  // Next.js types a searchParams value as `string | string[] | undefined`,
  // and a duplicated query key (`?class=a&class=b`) produces an ARRAY at
  // runtime whatever this function's own parameter type promises — the exact
  // hazard `parseCursor`'s own comment documents for `?before=`. A
  // single-element array is the sharper case: `Array.prototype.toString`
  // joins a lone element with no comma at all, so a validator that coerces
  // via `String(raw)` instead of checking `typeof raw === "string"` would
  // wrongly accept it.
  it("rejects a non-string value by type, not by coercion (mutation: validate String(raw) instead of typeof raw === 'string' -> FAILS)", () => {
    // @ts-expect-error — exercising the runtime shape Next.js can hand this
    // function despite what its parameter type promises.
    expect(parseScreenedClass(["misconfigured"])).toBeUndefined();
  });
});
