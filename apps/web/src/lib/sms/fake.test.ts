import { describe, it, expect, vi, afterEach } from "vitest";
import { fakeSmsProvider } from "./fake";

/**
 * The fake provider is the escape hatch that makes the "code is never
 * legible" claim (alert-phone-verification.ts, 0036's own migration
 * comment) true only in PRODUCTION. Everywhere else — every dev machine,
 * every non-prod deploy, every test run — this fake is what actually sends,
 * and it logs the message body so a developer can see what would have gone
 * out. A six-digit verification code sitting in that body is exactly as
 * legible as a dashboard row would have been, to anyone who can read the
 * console. Redacting a bare six-digit run keeps the log useful (to whom,
 * whether a send was attempted) without reprinting a code.
 */
describe("fakeSmsProvider — a six-digit code in the body is never printed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts a six-digit run in the logged body (mutation: log input.body unredacted → FAILS)", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const provider = fakeSmsProvider();

    await provider.send({
      to: "+19565550001",
      from: "+19565550002",
      body: "Your BIS verification code is 482913. It expires in 10 minutes.",
    });

    const logged = infoSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).not.toContain("482913");
  });

  it("still logs the recipient, so a developer can see who a send would have reached", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const provider = fakeSmsProvider();

    await provider.send({
      to: "+19565550001",
      from: "+19565550002",
      body: "Your BIS verification code is 482913. It expires in 10 minutes.",
    });

    const logged = infoSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("+19565550001");
  });
});
