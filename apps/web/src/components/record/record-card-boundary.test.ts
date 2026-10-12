import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { RecordCardBoundary, RecordCardBoundaryCore } = await import("./record-card-boundary");

function Boom(): never { throw new Error("card render failed"); }
const fallback = () => createElement("p", null, "fell back");

describe("RecordCardBoundary (spec C5): one card's render throw never blanks the page", () => {
  it("on the server, a throw inside renders that card's skeleton and its siblings still render (mutation: drop the Suspense -> renderToStaticMarkup throws, FAILS)", () => {
    const html = renderToStaticMarkup(createElement("div", null,
      createElement(RecordCardBoundary, { fallback, skeleton: createElement("i", { "data-record-skeleton": "" }) }, createElement(Boom)),
      createElement("p", null, "sibling card")));
    expect(html).toContain("data-record-skeleton");
    expect(html).toContain("sibling card");
  });

  it("on the client, a caught error shows the fallback, and its reset clears the error and asks for a refresh (mutation: render children when failed -> FAILS)", () => {
    expect(RecordCardBoundaryCore.getDerivedStateFromError()).toEqual({ failed: true });
    const onReset = vi.fn();
    const core = new RecordCardBoundaryCore({ fallback, onReset, children: createElement("p", null, "body") });
    core.state = { failed: true };
    expect(renderToStaticMarkup(createElement("div", null, core.render()))).toContain("fell back");
    const setState = vi.spyOn(core, "setState").mockImplementation(() => {});
    core.reset();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenCalledWith({ failed: false });
  });
});
