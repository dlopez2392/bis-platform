import { describe, it, expect, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: vi.fn(async () => ({ userId: "user_1" })) }));
vi.mock("@/lib/db", () => ({ dbForRequest: vi.fn(async () => ({})) }));
const completeTask = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), completeTask }));

import { HoldUndecidedError } from "@bis/db";
import { revalidatePath } from "next/cache";
import { completeTaskAction } from "./actions";

const form = (taskId: string) => { const f = new FormData(); f.set("contactId", "c1"); f.set("taskId", taskId); return f; };

describe("completeTaskAction — the timeline's 'complete' (review R3-I1)", () => {
  it("a stale page's Done on a hold's undecided To-do is refused without an error page: the page re-renders, and the timeline then shows its hint in place of Done (mutation: let HoldUndecidedError propagate → rejects, FAILS)", async () => {
    completeTask.mockRejectedValueOnce(new HoldUndecidedError());
    await expect(completeTaskAction("a1", form("t1"))).resolves.toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts/c1");
  });

  it("any other failure still throws, as before (mutation: swallow every error → FAILS)", async () => {
    completeTask.mockRejectedValueOnce(new Error("update failed"));
    await expect(completeTaskAction("a1", form("t2"))).rejects.toThrow("update failed");
  });
});
