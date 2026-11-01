import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";

/**
 * Review M3 of fix/batch-oct31: choosing a result unmounts the focused result button, so focus fell to <body>
 * and a keyboard user lost their place in the dialog. After a choice focus goes to "Choose someone else"; after
 * that, back to the search box. Both by `autoFocus` (React focuses the element as it mounts; the server render
 * shows it as `autofocus`). No DOM renderer in apps/web: React's hooks are answered by position
 * (add-relationship-dialog.test.ts's idiom), and the picker is called as a function to reach the handlers its
 * elements carry. STATE_COUNT pins the positions: a state added or moved reds that check first, by name.
 */
const STATE = { query: 0, hits: 1, chosen: 2, focusAfter: 3 } as const;
const STATE_COUNT = 4;
const harness = vi.hoisted(() => ({ overrides: new Map<number, unknown>(), calls: 0, setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: () => {},
    useRef: (init: unknown) => ({ current: init }),
    useState: (init: unknown) => {
      const i = harness.calls++;
      const set = vi.fn();
      harness.setters[i] = set;
      return [harness.overrides.has(i) ? harness.overrides.get(i) : init, set];
    },
  };
});

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { DealContactPicker, DealContactHit } = await import("./deal-contact-picker");
const { m } = await import("@/lib/messages");

const ACCT = "11111111-1111-4111-8111-111111111111";
const HIT = { id: "C1", label: "Ana García", sublabel: null, at: null, href: "/x" };
type State = Partial<Record<keyof typeof STATE, unknown>>;

function arm(state: State) {
  harness.calls = 0;
  harness.setters = [];
  harness.overrides = new Map(Object.entries(state).map(([k, v]) => [STATE[k as keyof typeof STATE], v]));
}
const render = (state: State) => { arm(state); return renderToStaticMarkup(createElement(DealContactPicker, { accountId: ACCT, labelId: "l" })); };
/** The picker's own element tree (its children are not rendered), with the hooks answered from `state`. */
const tree = (state: State) => { arm(state); return DealContactPicker({ accountId: ACCT, labelId: "l" }) as ReactElement; };

function find(node: ReactNode, pred: (el: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const n of node) { const f = find(n, pred); if (f) return f; }
    return null;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const el = node as ReactElement<Record<string, unknown>>;
  if (pred(el)) return el;
  return find(el.props.children as ReactNode, pred);
}

beforeEach(() => { harness.overrides = new Map(); });

describe("the picker's focus after a choice", () => {
  it("answers exactly STATE_COUNT states (a moved or added state reds here first)", () => {
    render({});
    expect(harness.calls).toBe(STATE_COUNT);
  });

  it("choosing a result asks for focus on \"Choose someone else\" (mutation: choose() leaves focus alone -> FAILS)", () => {
    const hits = { query: "ana", status: "ready", contacts: [HIT] };
    const hit = find(tree({ hits }), (el) => el.type === DealContactHit);
    expect(hit).not.toBeNull();
    (hit!.props.onChoose as () => void)();
    expect(harness.setters[STATE.chosen]).toHaveBeenCalledWith({ id: "c1", name: "Ana García" });
    expect(harness.setters[STATE.focusAfter]).toHaveBeenCalledWith("change");
  });

  it("after a choice, \"Choose someone else\" mounts focused (mutation: drop its autoFocus -> FAILS)", () => {
    const html = render({ chosen: { id: "c1", name: "Ana García" }, focusAfter: "change" });
    expect(html).toMatch(new RegExp(`<button[^>]*autofocus=""[^>]*>.*${m["pipeline.contactChange"]}`));
    expect(html).not.toMatch(/<input[^>]*type="search"/);
  });

  it("\"Choose someone else\" asks for focus back on the search box, which mounts focused", () => {
    const change = find(tree({ chosen: { id: "c1", name: "Ana García" }, focusAfter: "change" }),
      (el) => typeof el.props.onClick === "function");
    expect(change).not.toBeNull();
    (change!.props.onClick as () => void)();
    expect(harness.setters[STATE.chosen]).toHaveBeenCalledWith(null);
    expect(harness.setters[STATE.focusAfter]).toHaveBeenCalledWith("box");
    expect(render({ focusAfter: "box" })).toMatch(/<input[^>]*type="search"[^>]*autofocus=""|<input[^>]*autofocus=""[^>]*type="search"/);
  });

  it("when the dialog first opens nothing takes focus from it (the dialog's own first focus stands)", () => {
    expect(render({})).not.toContain("autofocus");
  });
});
