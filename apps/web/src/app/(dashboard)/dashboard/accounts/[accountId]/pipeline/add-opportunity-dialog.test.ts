import { describe, it, expect, vi } from "vitest";
import { submitNewDeal } from "./add-opportunity-dialog";
import { m } from "@/lib/messages";

/**
 * The Add opportunity dialog's submit (review M1 of fix/batch-oct31): the dialog's hook hands every press to
 * `submitNewDeal`, a plain function, so "no customer chosen never reaches the action" is tested here without a
 * DOM. The action, the toast and the close are passed in.
 */
function deps() {
  return { action: vi.fn(async () => {}), notify: vi.fn(), close: vi.fn() };
}
function form(contactId: string) {
  const fd = new FormData();
  fd.set("contactId", contactId);
  fd.set("name", "Deck build");
  fd.set("pipelineId", "pipe1");
  return fd;
}

describe("submitNewDeal", () => {
  it("with no customer chosen it never calls the action, says why, and stays open (mutation: `const block = null` -> FAILS)", async () => {
    const d = deps();
    await submitNewDeal(form(""), d);
    expect(d.action).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledWith("Choose who this opportunity is for first.");
    expect(m["pipeline.contactRequired"]).toBe("Choose who this opportunity is for first.");
    expect(d.close).not.toHaveBeenCalled();
  });

  it("with a customer chosen it calls the action with the form, then closes, saying nothing", async () => {
    const d = deps();
    const fd = form("c1");
    await submitNewDeal(fd, d);
    expect(d.action).toHaveBeenCalledWith(fd);
    expect(d.close).toHaveBeenCalledTimes(1);
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("a failed action says so and stays open", async () => {
    const d = deps();
    d.action.mockRejectedValueOnce(new Error("boom"));
    await submitNewDeal(form("c1"), d);
    expect(d.notify).toHaveBeenCalledWith(m["pipeline.createFailed"]);
    expect(d.close).not.toHaveBeenCalled();
  });
});
