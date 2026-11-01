import { describe, it, expect, vi } from "vitest";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { runUndoReplyStop, runStopEmailsFromReply } from "./inbound-notice-handlers";

/**
 * Task 11, bis-frontend half: every call this bubble makes into the server
 * goes through here (Task 10's `replies-row-handlers.ts` pattern) so a
 * THROWN action — a stale deployment, an expired session — still toasts
 * (`lib/forms/action-feedback.ts`'s documented incident), and so Undo
 * branches on the typed `expired` FIELD the server sets, never on matching
 * its (translatable) error string.
 */
function toast() {
  return { success: vi.fn(), error: vi.fn() };
}

describe("runUndoReplyStop", () => {
  it("on ok: toasts stopUndone and reports not-expired (mutation: skip toast.success → FAILS)", async () => {
    const tt = toast();
    const onDone = vi.fn();
    await runUndoReplyStop(async () => ({ ok: true }), tt, "en", onDone);
    expect(tt.success).toHaveBeenCalledWith(t(m, "conversations.reply.stopUndone", "en"));
    expect(onDone).toHaveBeenCalledWith(false);
    expect(tt.error).not.toHaveBeenCalled();
  });

  it("branches on the typed expired FIELD, not the error string (mutation: check error === replyExpiredExplain text instead of the field → a THROWN-vs-expired distinction collapses, FAILS)", async () => {
    const tt = toast();
    const onDone = vi.fn();
    // A result that carries `expired: true` even though its error string is something else entirely
    // still must be read as expired — proving the branch reads the FIELD.
    await runUndoReplyStop(async () => ({ ok: false, error: "unrelated text", expired: true }), tt, "en", onDone);
    expect(onDone).toHaveBeenCalledWith(true);
    expect(tt.error).not.toHaveBeenCalled();
    expect(tt.success).not.toHaveBeenCalled();
  });

  it("a non-expired ok:false shows the server's own string VERBATIM and does not call onDone (S-10 T9a: inbound-actions.ts now resolves the reader's own locale itself and hands back an already-localized string — re-mapping it here to the generic held.failed line would discard it; mutation: toast the generic held.failed line instead of result.error → FAILS)", async () => {
    const tt = toast();
    const onDone = vi.fn();
    const alreadyLocalized = t(m, "contact.email.noEmail", "es");
    await runUndoReplyStop(async () => ({ ok: false, error: alreadyLocalized }), tt, "es", onDone);
    expect(tt.error).toHaveBeenCalledWith(alreadyLocalized);
    expect(tt.error).not.toHaveBeenCalledWith(t(m, "conversations.held.failed", "es"));
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a THROWN action shows the crash toast, in the reader's language (mutation: remove the catch → FAILS)", async () => {
    const tt = toast();
    const onDone = vi.fn();
    await runUndoReplyStop(async () => { throw new Error("boom"); }, tt, "es", onDone);
    expect(tt.error).toHaveBeenCalledWith(t(m, "common.actionCrashed", "es"));
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("runStopEmailsFromReply", () => {
  it("on ok: toasts stopDone and calls onDone (mutation: skip onDone → FAILS)", async () => {
    const tt = toast();
    const onDone = vi.fn();
    await runStopEmailsFromReply(async () => ({ ok: true }), tt, "en", onDone);
    expect(tt.success).toHaveBeenCalledWith(t(m, "conversations.reply.stopDone", "en"));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("ok:false shows the server's own already-localized string verbatim (S-10 T9a; mutation: toast the generic held.failed line instead of result.error → FAILS)", async () => {
    const tt = toast();
    const alreadyLocalized = t(m, "conversations.held.changed", "es");
    await runStopEmailsFromReply(async () => ({ ok: false, error: alreadyLocalized }), tt, "es", vi.fn());
    expect(tt.error).toHaveBeenCalledWith(alreadyLocalized);
  });

  it("a THROWN action shows the crash toast (mutation: remove the catch → FAILS)", async () => {
    const tt = toast();
    await runStopEmailsFromReply(async () => { throw new Error("boom"); }, tt, "en", vi.fn());
    expect(tt.error).toHaveBeenCalledWith(t(m, "common.actionCrashed", "en"));
  });
});
