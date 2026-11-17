import { describe, it, expect, vi } from "vitest";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import CheckinError from "./error";

/** The tree the boundary returns, walked for its one button (the boundary uses no hooks, so it can be called directly). */
function findButton(node: ReactNode): ReactElement<{ onClick: () => void; className?: string }> | null {
  if (Array.isArray(node)) {
    for (const n of node) { const b = findButton(n); if (b) return b; }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === "button") return node as ReactElement<{ onClick: () => void; className?: string }>;
  return findButton((node.props as { children?: ReactNode }).children);
}

const html = () => renderToStaticMarkup(createElement(CheckinError, { error: new Error("boom"), reset: () => {} }));
const visible = (h: string) => renderedText(h.replace(/<style>[\s\S]*?<\/style>/g, "")).replace(/\s+/g, " ").trim();

describe("/r/[token]/error.tsx: a boundary gets no locale, so both languages stand stacked", () => {
  it("English and Spanish, each in its own lang, compared with the literal words (mutation: one language only -> FAILS)", () => {
    const out = html();
    const en = /<section lang="en"[^>]*>(.*?)<\/section>/.exec(out)?.[1] ?? "";
    const es = /<section lang="es"[^>]*>(.*?)<\/section>/.exec(out)?.[1] ?? "";
    expect(visible(en)).toBe("Something went wrong on our side. Please try again in a moment.");
    expect(visible(es)).toBe("Algo salió mal de nuestro lado. Por favor intente de nuevo en un momento.");
    expect(visible(out)).toContain("Try again / Intentar de nuevo");
  });

  it("names nothing that broke: the error's own message never reaches the page", () => {
    expect(visible(html())).not.toContain("boom");
  });

  it("its one button calls reset (mutation: a button with no onClick -> FAILS)", () => {
    const reset = vi.fn();
    const button = findButton(CheckinError({ error: new Error("boom"), reset }));
    expect(button?.props.className).toBe("bis-checkin-primary");
    button?.props.onClick();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("carries the page's own stylesheet (the page's <style> never rendered when it threw)", () => {
    expect(html()).toContain(".bis-checkin-primary");
  });
});
