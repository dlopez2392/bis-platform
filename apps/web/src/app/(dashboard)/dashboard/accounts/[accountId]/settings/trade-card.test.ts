import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { tradeToasts } from "./trade-card";

beforeEach(() => { toastMock.success.mockReset(); toastMock.error.mockReset(); });

/**
 * The Trade card's toasts render in Sonner's toaster, which sits in the page's English shell; the card
 * reads in the operator's language, so each toast states its own (design check I3, lower weight).
 */
describe("tradeToasts", () => {
  it("wraps each toast in the card's language (mutation: toast the bare string -> FAILS)", () => {
    const t = tradeToasts("es");
    t.success("Giro guardado.");
    t.error("No se guardó el giro. Inténtelo de nuevo.");
    const ok = toastMock.success.mock.calls[0]?.[0] as ReactElement;
    const bad = toastMock.error.mock.calls[0]?.[0] as ReactElement;
    expect(isValidElement(ok) && renderToStaticMarkup(ok)).toBe('<span lang="es">Giro guardado.</span>');
    expect(isValidElement(bad) && renderToStaticMarkup(bad)).toBe('<span lang="es">No se guardó el giro. Inténtelo de nuevo.</span>');
  });
});
