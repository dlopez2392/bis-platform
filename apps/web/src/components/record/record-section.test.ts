import { describe, it, expect, vi } from "vitest";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
// A fixed id, so the component can also be CALLED (outside a render) to read its element tree. An
// ESM namespace cannot be spied on, so the module is mocked; react-dom/server keeps the real React.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), useId: () => "sec" }));
const { RecordSection } = await import("./record-section");
const { RecordCardError } = await import("./record-card");
const { RecordCardBoundary } = await import("./record-card-boundary");

const base = { id: "recent", label: "Recent", errorText: "Couldn't load Recent.", retryLabel: "Try again", onRetry: () => {} };
const html = (over: Partial<Parameters<typeof RecordSection>[0]>, body: unknown = createElement("p", null, "rows")) =>
  renderToStaticMarkup(createElement(RecordSection, { ...base, state: "ready", ...over }, body as never));

/** Every element in a tree returned by calling the component (hooks: only useId, below). */
function elements(node: unknown, out: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) { node.forEach((n) => elements(n, out)); return out; }
  if (!isValidElement(node)) return out;
  const el = node as ReactElement<Record<string, unknown>>;
  out.push(el);
  elements(el.props.children, out);
  return out;
}

describe("RecordSection (S-03 part 3 C4): a flat section, its own states", () => {
  it("a mono label (DESIGN.md's Label role) that names the section (mutation: drop aria-labelledby -> FAILS)", () => {
    const out = html({});
    expect(out).toMatch(/<section data-record-section="recent" data-state="ready" aria-labelledby="sec"/);
    expect(out).toMatch(/<h3 id="sec" class="[^"]*font-mono[^"]*text-\[10px\][^"]*uppercase[^"]*tracking-\[0\.14em\]/);
  });

  it("no label, no heading and no aria-labelledby (the facts line continues the header)", () => {
    const out = html({ label: null });
    expect(out).not.toContain("<h3");
    expect(out).not.toContain("aria-labelledby");
  });

  it("a rule between sections on the --line token, never a glass card (mutation: add glass -> FAILS)", () => {
    const out = html({});
    expect(out).toMatch(/class="[^"]*border-t[^"]*border-\[var\(--line\)\]/);
    expect(out).not.toMatch(/\bglass\b|rounded-xl|bg-card/);
  });

  it("loading: the skeleton given, else rows; never the body, never a spinner (rule 7; mutation: render children while loading -> FAILS)", () => {
    expect(html({ state: "loading" })).toContain("data-record-skeleton");
    expect(html({ state: "loading" })).not.toContain(">rows<");
    expect(html({ state: "loading", skeleton: createElement("div", { "data-testid": "drawer-skeleton" }) })).toContain('data-testid="drawer-skeleton"');
    expect(html({ state: "loading" })).not.toMatch(/animate-spin/);
  });

  it("error: the section's sentence and Try again as an alert, no body (mutation: render children on error -> FAILS)", () => {
    const out = html({ state: "error" });
    expect(out).toMatch(/role="alert"/);
    expect(out).toContain("Couldn&#x27;t load Recent.");
    expect(out).toContain(">Try again<");
    expect(out).not.toContain(">rows<");
  });

  it("ready and empty both draw the body the caller gives (the empty sentence is the caller's)", () => {
    expect(html({ state: "ready" })).toContain(">rows<");
    expect(html({ state: "empty" }, createElement("p", null, "nothing yet"))).toContain(">nothing yet<");
  });

  it("Try again, and the boundary's reset, call onRetry, never the router (mutation: omit onRetry from RecordCardError or the boundary -> FAILS)", () => {
    const onRetry = vi.fn();
    const errorTree = elements(RecordSection({ ...base, state: "error", onRetry }));
    expect(errorTree.find((e) => e.type === RecordCardError)?.props.onRetry).toBe(onRetry);
    const readyTree = elements(RecordSection({ ...base, state: "ready", onRetry }));
    expect(readyTree.find((e) => e.type === RecordCardBoundary)?.props.onReset).toBe(onRetry);
    expect(refresh).not.toHaveBeenCalled();
  });
});
