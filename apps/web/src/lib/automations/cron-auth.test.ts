import { describe, it, expect } from "vitest";
import { cronAuthorized } from "./cron-auth";

/**
 * One helper for every cron route (F-196): the dispatcher, both pass routes
 * and demo-refresh. Two failure modes, never one: no secret configured means
 * the route refuses to exist ("unset", a 503), a wrong bearer is "denied" (a
 * 401). Both before any query.
 */
const req = (authorization?: string) => new Request("https://app.example.com/api/cron/reminders", {
  headers: authorization === undefined ? {} : { authorization },
});
const env = (CRON_SECRET?: string) => ({ ...(CRON_SECRET === undefined ? {} : { CRON_SECRET }) }) as NodeJS.ProcessEnv;

describe("cronAuthorized", () => {
  it("is \"unset\" when CRON_SECRET is unset, even for a request carrying a bearer", () => {
    expect(cronAuthorized(req("Bearer anything"), env())).toBe("unset");
  });

  it("is \"unset\" when CRON_SECRET is the empty string (an empty secret must not match `Bearer `)", () => {
    expect(cronAuthorized(req("Bearer "), env(""))).toBe("unset");
  });

  it("is \"denied\" for a request with no authorization header", () => {
    expect(cronAuthorized(req(), env("s3cret"))).toBe("denied");
  });

  it("is \"denied\" for a wrong secret of the SAME length (the constant-time compare decides)", () => {
    expect(cronAuthorized(req("Bearer s3creX"), env("s3cret"))).toBe("denied");
  });

  it("is \"denied\" for a wrong-LENGTH header, without throwing (mutation: drop the length check -> timingSafeEqual throws, FAILS)", () => {
    expect(cronAuthorized(req("Bearer s3cret-and-more"), env("s3cret"))).toBe("denied");
  });

  it("is \"denied\" for the bare secret without the Bearer scheme", () => {
    expect(cronAuthorized(req("s3cret"), env("s3cret"))).toBe("denied");
  });

  it("is \"ok\" for exactly `Bearer ${CRON_SECRET}`", () => {
    expect(cronAuthorized(req("Bearer s3cret"), env("s3cret"))).toBe("ok");
  });

  it("reads process.env by default", () => {
    const before = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "from-process";
    try {
      expect(cronAuthorized(req("Bearer from-process"))).toBe("ok");
    } finally {
      if (before === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = before;
    }
  });
});
