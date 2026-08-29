import { describe, it, expect, vi } from "vitest";

vi.mock("./daily", () => ({
  createDailyProvider: vi.fn(() => ({ createMeetingRoom: vi.fn() })),
}));

import { getMeetingProvider } from "./provider";
import { createDailyProvider } from "./daily";

describe("getMeetingProvider", () => {
  it("returns null when DAILY_API_KEY is unset", () => {
    expect(getMeetingProvider({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("returns null when DAILY_API_KEY is blank", () => {
    expect(getMeetingProvider({ DAILY_API_KEY: "   " } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("returns a Daily-backed provider when DAILY_API_KEY is set", () => {
    const provider = getMeetingProvider({ DAILY_API_KEY: "dk_live" } as unknown as NodeJS.ProcessEnv);

    expect(provider).not.toBeNull();
    expect(createDailyProvider).toHaveBeenCalledWith("dk_live");
  });

  it("defaults to process.env when no env is passed", () => {
    const prior = process.env.DAILY_API_KEY;
    process.env.DAILY_API_KEY = "dk_process";
    try {
      const provider = getMeetingProvider();
      expect(provider).not.toBeNull();
      expect(createDailyProvider).toHaveBeenCalledWith("dk_process");
    } finally {
      if (prior === undefined) delete process.env.DAILY_API_KEY;
      else process.env.DAILY_API_KEY = prior;
    }
  });
});
