import { describe, it, expect, vi } from "vitest";
import { m } from "@/lib/messages";
import { Button } from "@/components/ui/button";

/**
 * S-10 leftovers (#317 follow-up, item 7): Stop emails and Resume emails both called their
 * server action with no locale argument at all — ctx.locale always defaulted to "en" on the
 * server regardless of who clicked, so every error line email-staff-actions.ts can build was
 * always English.
 *
 * Same no-DOM-renderer, override-by-call-index pattern as texts-row.note.wiring.test.ts:
 * useState's hooks are recorded in source order (adopted, view, resuming, note — EmailRow's own
 * ReadyRow), useContext answers "es" (useLocale() reads useContext under it), and the tree is
 * walked by calling function components directly.
 */
let callIndex = 0;
let overrides: Record<number, unknown> = {};
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => {
      const idx = callIndex++;
      const initial = idx in overrides ? overrides[idx] : (typeof init === "function" ? (init as () => unknown)() : init);
      return [initial, vi.fn()];
    },
    useTransition: () => [false, (cb: () => unknown) => { void cb(); }],
    useRef: (init: unknown) => ({ current: init }),
    useEffect: () => {},
    useContext: () => "es",
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const stopEmailsAction = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const resumeEmailsAction = vi.fn<(...a: unknown[]) => Promise<unknown>>();
// Review fix round (I-2): captured (not bare vi.fn()) so the Undo test below can assert
// what ReadyRow's own `undo` closure (email-row.tsx:99) actually called it with.
const undoStopEmailsActionMock = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ ok: true, view: { kind: "allowed", newestId: null } }));
vi.mock("./email-actions", () => ({
  stopEmailsAction: (...a: unknown[]) => stopEmailsAction(...a),
  undoStopEmailsAction: (...a: unknown[]) => undoStopEmailsActionMock(...a),
  resumeEmailsAction: (...a: unknown[]) => resumeEmailsAction(...a),
}));

const { EmailRow } = await import("./email-row");

type El = { type: unknown; props: Record<string, unknown> };
function isEl(n: unknown): n is El {
  return !!n && typeof n === "object" && "type" in (n as object);
}
function find(node: unknown, pred: (el: El) => boolean): El | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = find(n, pred);
      if (hit) return hit;
    }
    return null;
  }
  if (!isEl(node)) return null;
  const props = node.props ?? {};
  if (pred({ type: node.type, props })) return { type: node.type, props };
  if (typeof node.type === "function") return find((node.type as (p: unknown) => unknown)(props), pred);
  return find(props.children, pred);
}

function render(view: unknown): El {
  callIndex = 0;
  const load = { status: "ready" as const, view, zone: "America/Chicago" };
  const root = (EmailRow as unknown as (p: unknown) => unknown)({ accountId: "a1", contactId: "c1", load, showTitle: true });
  if (!isEl(root)) throw new Error("EmailRow returned no element for a ready load");
  const inner = (root.type as (p: unknown) => unknown)(root.props);
  if (!isEl(inner)) throw new Error("ReadyRow returned no element");
  return inner;
}

describe("Stop emails and Resume emails thread the reader's locale to their server action (S-10 leftovers item 7)", () => {
  it("Stop emails passes the reader's locale (mutation: drop the locale arg -> FAILS)", async () => {
    overrides = {};
    stopEmailsAction.mockResolvedValueOnce({ ok: true, view: { kind: "stopped", eventId: "e9", since: "2026-10-04T02:30:00Z", how: { kind: "staff" }, canResume: true } });
    const tree = render({ kind: "allowed", newestId: "e9" });
    const btn = find(tree, (el) => el.type === Button && el.props.children === m["contact.email.stopEmails.es"]);
    expect(btn).not.toBeNull();
    (btn!.props.onClick as () => void)();
    await vi.waitFor(() => expect(stopEmailsAction).toHaveBeenCalled());
    expect(stopEmailsAction).toHaveBeenCalledWith("a1", "c1", "e9", "es");
  });

  it("Resume emails passes the reader's locale (mutation: drop the locale arg -> FAILS)", async () => {
    // ReadyRow's own useState order: adopted(0), view(1), resuming(2), note(3) — index 2
    // forced true so the Resume form renders without needing a real re-render.
    overrides = { 2: true };
    resumeEmailsAction.mockResolvedValueOnce({ ok: true, view: { kind: "allowed", newestId: null } });
    const tree = render({ kind: "stopped", eventId: "e1", since: "2026-10-04T02:30:00Z", how: { kind: "staff" }, canResume: true });
    const form = find(tree, (el) => el.props["data-testid"] === "email-resume-form");
    expect(form).not.toBeNull();
    await (form!.props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault: () => {} });
    expect(resumeEmailsAction).toHaveBeenCalledWith("a1", "c1", "e1", "", "es");
  });
});

/**
 * Review fix round (I-2): the success toast's own Undo action (lib/consent/email-row.ts's
 * runEmailAction) calls ReadyRow's own `undo` closure (email-row.tsx:99), which threads
 * `locale` into undoStopEmailsAction — captured here from the mocked sonner's own call args,
 * never asserted before this round (mutation: drop the locale arg from the `undo` closure -> FAILS).
 */
describe("the success toast's own Undo action threads the reader's locale too (review fix round, I-2)", () => {
  it("undo Stop emails passes the reader's locale", async () => {
    overrides = {};
    const { toast } = await import("sonner");
    vi.mocked(toast.success).mockClear();
    stopEmailsAction.mockResolvedValueOnce({ ok: true, view: { kind: "stopped", eventId: "e9", since: "2026-10-04T02:30:00Z", how: { kind: "staff" }, canResume: true }, undo: { kind: "stop", eventId: "e9" } });
    const tree = render({ kind: "allowed", newestId: "e9" });
    const btn = find(tree, (el) => el.type === Button && el.props.children === m["contact.email.stopEmails.es"]);
    (btn!.props.onClick as () => void)();
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [, opts] = vi.mocked(toast.success).mock.calls[0]!;
    const onUndo = (opts as unknown as { action: { onClick: () => unknown } }).action.onClick;
    onUndo();
    await vi.waitFor(() => expect(undoStopEmailsActionMock).toHaveBeenCalled());
    expect(undoStopEmailsActionMock).toHaveBeenCalledWith("a1", "c1", "e9", "es");
  });
});
