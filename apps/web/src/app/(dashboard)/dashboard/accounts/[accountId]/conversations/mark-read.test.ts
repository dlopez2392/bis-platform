import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
const { markReadThenRefresh } = await import("./mark-read");

/**
 * M7a PR-4 (review I2): markConversationReadAction no longer revalidates (an action that stays usable while
 * the account is paused must not re-render inside its own request, where the read-only guard would refuse
 * the render). MarkRead refreshes the page itself once the write has landed, as a plain render.
 */
describe("MarkRead refreshes after the write, never instead of it", () => {
  it("awaits the action, then refreshes (mutation: refresh before awaiting the action -> FAILS)", async () => {
    const order: string[] = [];
    let release!: () => void;
    const action = vi.fn(() => new Promise<void>((res) => { release = () => { order.push("written"); res(); }; }));
    const refresh = vi.fn(() => { order.push("refresh"); });
    const done = markReadThenRefresh(action, "convo_9", refresh);
    await Promise.resolve();
    expect(action).toHaveBeenCalledWith("convo_9");
    expect(refresh).not.toHaveBeenCalled();
    release();
    await done;
    expect(order).toEqual(["written", "refresh"]);
  });

  it("a failed or refused write does not refresh (mutation: refresh in a finally -> FAILS)", async () => {
    const refresh = vi.fn();
    await expect(markReadThenRefresh(async () => { throw new Error("NEXT_REDIRECT"); }, "convo_9", refresh)).rejects.toThrow("NEXT_REDIRECT");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("MarkRead's effect goes through it with the router's refresh (mutation: call the action directly again -> FAILS)", () => {
    const src = readFileSync(join(__dirname, "mark-read.tsx"), "utf8");
    expect(src).toMatch(/markReadThenRefresh\(action, conversationId, \(\) => router\.refresh\(\)\)/);
    expect(src).not.toMatch(/void action\(/);
  });
});
