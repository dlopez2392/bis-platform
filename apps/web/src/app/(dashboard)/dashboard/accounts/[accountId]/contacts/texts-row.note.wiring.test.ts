import { describe, it, expect, vi } from "vitest";
import { m } from "@/lib/messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TextsView } from "@/lib/consent/texts-view";

/**
 * Fix round 1 #1, #4: the Resume form's `note` field must never survive
 * across stops (a later Stop → Resume must not open pre-filled with the
 * previous reason, one click saving stale required evidence), and the
 * submit must not be pressable while the trimmed note is empty.
 *
 * No DOM renderer in apps/web (the codebase's own convention:
 * contact-drawer.wiring.test.ts):
 * `useState` is mocked to RECORD its setter (found by starting value) and,
 * when a test needs a state ReadyRow itself decides internally — `resuming`
 * — an override by the hook's own call INDEX, discovered dynamically on an
 * unrelated throwaway render rather than hardcoded, so reordering the
 * hooks in the source would break discovery loudly, not silently. Buttons
 * and the form are found by walking the plain element tree ReadyRow
 * returns (hooks are dumb mocks, so calling a function component directly,
 * with no DOM and no React renderer, is safe) rather than firing DOM
 * events that do not exist in this test environment.
 */
type StateEntry = { idx: number; initial: unknown; set: ReturnType<typeof vi.fn> };
let states: StateEntry[] = [];
let callIndex = 0;
let overrides: Record<number, unknown> = {};

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => {
      const idx = callIndex++;
      const initial = idx in overrides ? overrides[idx] : (typeof init === "function" ? (init as () => unknown)() : init);
      const set = vi.fn();
      states.push({ idx, initial, set });
      return [initial, set];
    },
    useTransition: () => [false, (cb: () => unknown) => { void cb(); }],
    useRef: (init: unknown) => ({ current: init }),
    useEffect: () => {},
    // S-03 part 3: TextsRow/ReadyRow now read useLocale() (useContext under
    // it), which needs React's real dispatcher — absent here, since this
    // file calls the function components directly rather than rendering a
    // tree. "en" is the same default LocaleProvider's context carries
    // outside a Provider, so this mirrors an unlocalized render exactly.
    useContext: () => "en",
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./actions", () => ({ setPhoneCountryAction: vi.fn(), undoPhoneCountryAction: vi.fn() }));
const resumeTextsAction = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const stopTextsAction = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const confirmStopAction = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const notAStopAction = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock("./texts-actions", () => ({
  stopTextsAction: (...a: unknown[]) => stopTextsAction(...a), undoStopTextsAction: vi.fn(),
  resumeTextsAction: (...a: unknown[]) => resumeTextsAction(...a),
  confirmStopAction: (...a: unknown[]) => confirmStopAction(...a),
  notAStopAction: (...a: unknown[]) => notAStopAction(...a),
  undoHoldDecisionAction: vi.fn(),
}));

const { TextsRow } = await import("./texts-row");

type El = { type: unknown; props: Record<string, unknown> };
function isEl(n: unknown): n is El {
  return !!n && typeof n === "object" && "type" in (n as object);
}
/** Depth-first search through the plain element tree a mocked-hooks render
 *  produces: expands a function component by calling it (safe — every hook
 *  it could reach is one of the dumb mocks above) and a fragment/array by
 *  its children; stops at the first match, native or component. */
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

const STOPPED_STAFF = { kind: "stopped" as const, eventId: "e1", since: "2026-10-04T02:30:00Z", how: { kind: "staff" as const }, canResume: true };
const LOAD = { status: "ready" as const, view: STOPPED_STAFF, zone: "America/Chicago", phone: "+15512345678" };

/** `TextsRow` itself calls only `useLocale()` (mocked to "en" above); the
 *  tree this returns for a "ready" load is exactly `<ReadyRow .../>`,
 *  called directly to reach ITS tree. `load` defaults to the resumable-stop
 *  fixture every pre-existing test here already expects. */
function render(load: { status: "ready"; view: TextsView; zone: string; phone: string } = LOAD): El {
  callIndex = 0;
  states = [];
  const root = (TextsRow as unknown as (p: unknown) => unknown)({ accountId: "a1", contactId: "c1", load });
  if (!isEl(root)) throw new Error("TextsRow returned no element for a ready, resumable stop");
  const inner = (root.type as (p: unknown) => unknown)(root.props);
  if (!isEl(inner)) throw new Error("ReadyRow returned no element");
  return inner;
}

/** The one hook call whose INITIAL value is `value` on a natural (no
 *  override) render — discovered fresh each time, never hardcoded, so a
 *  reordered hook in texts-row.tsx breaks this loudly (no match / two
 *  matches) rather than silently reading the wrong state. */
function indexWhereInitialIs(value: unknown): number {
  overrides = {};
  render();
  const hits = states.filter((s) => s.initial === value);
  if (hits.length !== 1) throw new Error(`expected exactly one state to start at ${JSON.stringify(value)}, found ${hits.length}`);
  return hits[0]!.idx;
}

describe("ReadyRow's Resume form — the note never survives across stops (fix round 1 #1)", () => {
  it("opening the Resume form clears any note left from an earlier stop, and marks it resuming (mutation: drop the clear from the open handler → the note setter is never called with \"\", FAILS)", () => {
    overrides = {};
    const tree = render();
    const noteIdx = states.filter((s) => s.initial === "").map((s) => s.idx);
    expect(noteIdx).toHaveLength(1);
    const noteState = states.find((s) => s.idx === noteIdx[0])!;
    const resumingState = states.find((s) => s.initial === false)!;

    const openBtn = find(tree, (el) => el.type === Button && el.props.children === m["contact.texts.resume"]);
    expect(openBtn).not.toBeNull();
    expect(noteState.set).not.toHaveBeenCalled();

    (openBtn!.props.onClick as () => void)();

    expect(noteState.set).toHaveBeenCalledWith("");
    expect(resumingState.set).toHaveBeenCalledWith(true);
  });

  it("a successful resume clears the note too, so the NEXT Stop → Resume opens blank (mutation: drop setNote(\"\") from show() → this stays unset, FAILS)", async () => {
    const resumingIdx = indexWhereInitialIs(false);
    const noteIdx = indexWhereInitialIs("");
    overrides = { [resumingIdx]: true, [noteIdx]: "a stale reason from last time" };
    const tree = render();
    const noteState = states.find((s) => s.idx === noteIdx)!;
    expect(noteState.initial).toBe("a stale reason from last time");

    resumeTextsAction.mockResolvedValueOnce({ ok: true, view: { kind: "allowed", newestId: "e2" } });
    const form = find(tree, (el) => el.props["data-testid"] === "texts-resume-form");
    expect(form).not.toBeNull();

    (form!.props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault: () => {} });
    await vi.waitFor(() => expect(noteState.set).toHaveBeenCalled());

    // S-10 leftovers (#317 follow-up, item 7): locale (here "en", useContext's own mock above)
    // now threads through so staff-actions.ts's error lines read the reader's own language.
    expect(resumeTextsAction).toHaveBeenCalledWith("a1", "c1", "e1", "a stale reason from last time", "en");
    expect(noteState.set).toHaveBeenCalledWith("");
  });
});

describe("ReadyRow's Resume form — the submit is disabled while the note is blank (fix round 1 #4)", () => {
  it("the note field is required and the submit is disabled with an empty note (mutation: drop required or the !note.trim() guard → FAILS)", () => {
    const resumingIdx = indexWhereInitialIs(false);
    overrides = { [resumingIdx]: true };
    const tree = render();

    const input = find(tree, (el) => el.type === Input && el.props.name === "note");
    expect(input).not.toBeNull();
    expect(input!.props.required).toBe(true);

    const submit = find(tree, (el) => el.type === Button && el.props.type === "submit");
    expect(submit).not.toBeNull();
    expect(submit!.props.disabled).toBe(true);
  });

  it("a non-blank note enables the submit (the server's own refusal on an empty note stays the backstop)", () => {
    const resumingIdx = indexWhereInitialIs(false);
    const noteIdx = indexWhereInitialIs("");
    overrides = { [resumingIdx]: true, [noteIdx]: "they called and asked" };
    const tree = render();

    const submit = find(tree, (el) => el.type === Button && el.props.type === "submit");
    expect(submit).not.toBeNull();
    expect(submit!.props.disabled).toBe(false);
  });
});

/**
 * S-10 leftovers (#317 follow-up, item 7): Stop texts (Allowed), Confirm stop and Not a stop
 * (On hold) all call their server action with no locale argument at all — ctx.locale always
 * defaulted to "en" on the server regardless of who clicked, so every error line
 * staff-actions.ts can build for these three actions was always English.
 */
describe("Stop texts, Confirm stop and Not a stop thread the reader's locale to their server action (S-10 leftovers item 7)", () => {
  it("Stop texts passes the reader's locale (mutation: drop the locale arg -> FAILS)", async () => {
    stopTextsAction.mockResolvedValueOnce({ ok: true, view: { kind: "stopped", eventId: "e9", since: "2026-10-04T02:30:00Z", how: { kind: "staff" }, canResume: true } });
    const tree = render({ status: "ready", view: { kind: "allowed" as const, newestId: "e9" }, zone: "America/Chicago", phone: "+15512345678" });
    const btn = find(tree, (el) => el.type === Button && el.props.children === m["contact.texts.stopTexts"]);
    expect(btn).not.toBeNull();
    (btn!.props.onClick as () => void)();
    await vi.waitFor(() => expect(stopTextsAction).toHaveBeenCalled());
    expect(stopTextsAction).toHaveBeenCalledWith("a1", "c1", "e9", "en");
  });

  const HELD = { status: "ready" as const, view: { kind: "held" as const, eventId: "h1", since: "2026-10-04T02:30:00Z", excerpt: "stop" }, zone: "America/Chicago", phone: "+15512345678" };

  it("Confirm stop passes the reader's locale (mutation: drop the locale arg -> FAILS)", async () => {
    confirmStopAction.mockResolvedValueOnce({ ok: true, view: { kind: "stopped", eventId: "h1", since: "2026-10-04T02:30:00Z", how: { kind: "free_text", excerpt: "stop" }, canResume: true } });
    const tree = render(HELD);
    const btn = find(tree, (el) => el.type === Button && el.props.children === m["contact.texts.confirmStop"]);
    expect(btn).not.toBeNull();
    (btn!.props.onClick as () => void)();
    await vi.waitFor(() => expect(confirmStopAction).toHaveBeenCalled());
    expect(confirmStopAction).toHaveBeenCalledWith("a1", "c1", "h1", "en");
  });

  it("Not a stop passes the reader's locale (mutation: drop the locale arg -> FAILS)", async () => {
    notAStopAction.mockResolvedValueOnce({ ok: true, view: { kind: "allowed", newestId: null } });
    const tree = render(HELD);
    const btn = find(tree, (el) => el.type === Button && el.props.children === m["contact.texts.notAStop"]);
    expect(btn).not.toBeNull();
    (btn!.props.onClick as () => void)();
    await vi.waitFor(() => expect(notAStopAction).toHaveBeenCalled());
    expect(notAStopAction).toHaveBeenCalledWith("a1", "c1", "h1", "en");
  });
});
