import { describe, it, expect, vi, beforeEach } from "vitest";

const randomIntMock = vi.hoisted(() => vi.fn());
vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:crypto")>()),
  randomInt: (...a: unknown[]) => randomIntMock(...a),
}));

import { decideDisclosure, DISCLOSURE_VALUES } from "./disclosure";

beforeEach(() => randomIntMock.mockReset());

describe("decideDisclosure", () => {
  it("off, null and undefined: no sentence, no stamp, and no coin is drawn", () => {
    for (const s of ["off", null, undefined] as const) {
      expect(decideDisclosure(s)).toEqual({ disclose: false, setting: null });
    }
    expect(randomIntMock).not.toHaveBeenCalled();
  });
  it("on: always says it and is stamped as On, with no coin (mutation: return setting 'trial' for on → FAILS)", () => {
    expect(decideDisclosure("on")).toEqual({ disclose: true, setting: "on" });
    expect(randomIntMock).not.toHaveBeenCalled();
  });
  it("trial: crypto.randomInt(2) is the coin, stamped as Trial either way (mutation: Math.random() < 0.5 → FAILS)", () => {
    randomIntMock.mockReturnValueOnce(1);
    expect(decideDisclosure("trial")).toEqual({ disclose: true, setting: "trial" });
    randomIntMock.mockReturnValueOnce(0);
    expect(decideDisclosure("trial")).toEqual({ disclose: false, setting: "trial" });
    expect(randomIntMock.mock.calls).toEqual([[2], [2]]);
  });
  it("lists exactly the three settings the CHECK allows", () => {
    expect(DISCLOSURE_VALUES).toEqual(["off", "trial", "on"]);
  });
});
