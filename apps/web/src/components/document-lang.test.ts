// S-10 T9b review M-4: DocumentLang must RELEASE its claim when it unmounts. Without the
// cleanup, a soft navigation out of the dashboard tree (to /no-access, or /sign-in after signing
// out) or out of an agency-only page would leave the old <html lang> behind.
//
// This repo's vitest runs in plain Node with no jsdom or happy-dom installed (vitest.config.ts
// sets no environment; package.json lists neither), so the component is not mounted here.
// Instead `useEffect` is captured as React calls it, and the effect and its cleanup are run by
// hand against a stand-in <html>: that is exactly what React does on mount and unmount, and it
// is the component's own code under test, not a copy. The browser pin is the e2e:
// spanish-dashboard.spec.ts's soft navigation to the Companies list and Back, which reads
// <html lang> move "es" -> "en" -> "es" without a reload.
import { describe, it, expect, vi, afterEach } from "vitest";

const h = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useEffect: (fn: () => void | (() => void)) => { h.effects.push(fn); },
}));

const html = { lang: "en" };
vi.stubGlobal("document", { documentElement: html });

const { DocumentLang } = await import("./document-lang");

/** Renders the component (a function call: it renders nothing) and runs its effect, as React's
 *  commit does; returns what React would keep as the cleanup. */
function mount(props: { lang: string; island?: boolean }): () => void {
  h.effects = [];
  DocumentLang(props);
  expect(h.effects).toHaveLength(1);
  const cleanup = h.effects[0]!();
  expect(typeof cleanup, "the effect returns a cleanup for React to call on unmount").toBe("function");
  return cleanup as () => void;
}

afterEach(() => { html.lang = "en"; });

describe("DocumentLang mounts and unmounts its claim on <html lang> (review M-4)", () => {
  it("sets the locale on mount and gives the root's \"en\" back on unmount (mutation: drop the effect's return -> FAILS)", () => {
    const unmount = mount({ lang: "es" });
    expect(html.lang).toBe("es");
    unmount();
    expect(html.lang).toBe("en");
  });

  it("an island unmounting hands the document back to the shell's locale, not to \"en\"", () => {
    const unmountShell = mount({ lang: "es" });
    const unmountIsland = mount({ lang: "en", island: true });
    expect(html.lang).toBe("en");
    unmountIsland();
    expect(html.lang).toBe("es");
    unmountShell();
    expect(html.lang).toBe("en");
  });
});
