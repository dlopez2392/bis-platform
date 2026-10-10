import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

// D-002: the Client access card carried two primary buttons (DESIGN.md rule
// 8), its switch never said whether access was on or off (rule 3: a status is
// a dot AND a word), and turning access off ran with no undo (rule 6: a
// reversible action runs at once with an undo toast).

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const { ClientAccessPanel, ClientAccessSwitch } = await import("./client-access-panel");

const noop = async () => {};
const panel = (enabled: boolean) =>
  renderToStaticMarkup(createElement(ClientAccessPanel, { enabled, setAccessAction: noop }));
const primaries = (html: string) => html.match(/btn-primary/g)?.length ?? 0;

/** Every element the (hook-free) switch RETURNS, so its form action can be
 *  reached and called without a DOM — this repo's vitest has none. */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((n) => elements(n as ReactNode));
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...elements(el.props.children as ReactNode)];
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
});

describe("ClientAccessPanel (D-002)", () => {
  // Staff and roles (Task 10): the invite left this card for the Team card
  // under it, which carries its own one primary. While access is on, this
  // card's only button is "Turn off", which stays ghost; while off, "Turn on"
  // is the one thing the card can do, so it is the primary.
  it("never carries more than ONE primary: none while on, Turn on while off (rule 8) (mutation: render Turn off as the default variant → FAILS)", () => {
    expect(primaries(panel(true))).toBe(0);
    expect(primaries(panel(false))).toBe(1);
  });

  it("no longer carries an invite form or a member list: the Team card owns both (mutation: leave the invite field → FAILS)", () => {
    const html = panel(true);
    expect(html).not.toContain('name="email"');
    expect(renderedText(html)).not.toContain("Members");
    expect(renderedText(html)).not.toContain(m["team.invite"]);
  });

  it("says whether access is on or off, as a dot AND a word (rule 3) (mutation: drop the status pill → FAILS)", () => {
    const on = panel(true);
    expect(on).toContain('data-status="on"');
    expect(renderedText(on)).toContain(m["clientAccess.statusOn"]);
    const off = panel(false);
    expect(off).toContain('data-status="off"');
    expect(renderedText(off)).toContain(m["clientAccess.statusOff"]);
  });
});

describe("ClientAccessSwitch (D-002)", () => {
  const formAction = (tree: ReactNode) => {
    const form = elements(tree).find((e) => e.type === "form");
    if (!form) throw new Error("no form in the switch");
    return form.props.action as (f: FormData) => Promise<void>;
  };

  it("turning access off runs at once, then offers an Undo that turns it back on (rule 6) (mutation: drop the undo → FAILS; undo with the same value → FAILS)", async () => {
    const calls: string[] = [];
    const setAccess = vi.fn(async (f: FormData) => { calls.push(String(f.get("enabled"))); });
    await formAction(ClientAccessSwitch({ enabled: true, setAccessAction: setAccess }))(new FormData());
    expect(calls).toEqual(["false"]);
    expect(toasts.success).toHaveBeenCalledOnce();
    expect(toasts.success.mock.calls[0]![0]).toBe(m["clientAccess.turnedOff"]);
    const opts = toasts.success.mock.calls[0]![1] as { action: { label: string; onClick: () => void } };
    expect(opts.action.label).toBe(m["common.undo"]);
    opts.action.onClick();
    await flush();
    expect(calls).toEqual(["false", "true"]);
  });

  it("a failed switch says so instead of a success toast (mutation: toast success regardless → FAILS)", async () => {
    const setAccess = vi.fn(async () => { throw new Error("boom"); });
    await formAction(ClientAccessSwitch({ enabled: false, setAccessAction: setAccess }))(new FormData());
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith(m["common.actionCrashed"]);
  });
});
