import { describe, it, expect } from "vitest";
import { parseTickNow, TICK_NOW_MAX_AGE_MS, TICK_NOW_MAX_AHEAD_MS } from "./pass-route";

/**
 * F-196: one tick, one now. The dispatcher's `now` travels in every pass
 * body, and a pass route builds its context from it, never `new Date()`. A
 * `now` older than one tick (900 s) or more than a minute ahead of the pass
 * route's own clock is refused: a replayed or forged body must not run a pass
 * against a different instant than the tick it claims to belong to.
 */
const WALL = Date.parse("2026-10-28T14:00:00.000Z");
const at = (ms: number) => ({ now: new Date(ms).toISOString() });

describe("parseTickNow", () => {
  it("the bounds are 900 s behind and 60 s ahead", () => {
    expect([TICK_NOW_MAX_AGE_MS, TICK_NOW_MAX_AHEAD_MS]).toEqual([900_000, 60_000]);
  });

  it("accepts the wall clock itself, as that instant", () => {
    expect(parseTickNow(at(WALL), WALL)?.getTime()).toBe(WALL);
  });

  it("accepts exactly 900 s old and exactly 60 s ahead (both bounds inclusive)", () => {
    expect(parseTickNow(at(WALL - 900_000), WALL)?.getTime()).toBe(WALL - 900_000);
    expect(parseTickNow(at(WALL + 60_000), WALL)?.getTime()).toBe(WALL + 60_000);
  });

  it("refuses 900_001 ms old and 60_001 ms ahead (mutation: widen the age bound to 1 h → FAILS)", () => {
    expect(parseTickNow(at(WALL - 900_001), WALL)).toBeNull();
    expect(parseTickNow(at(WALL + 60_001), WALL)).toBeNull();
  });

  it("refuses a body with no now, an unreadable now, a number for now, and a body that is not an object", () => {
    expect(parseTickNow({}, WALL)).toBeNull();
    expect(parseTickNow({ now: "yesterday" }, WALL)).toBeNull();
    expect(parseTickNow({ now: WALL }, WALL)).toBeNull();
    expect(parseTickNow(WALL, WALL)).toBeNull();
    expect(parseTickNow(null, WALL)).toBeNull();
    expect(parseTickNow("2026-10-28T14:00:00.000Z", WALL)).toBeNull();
  });
});
