import { describe, it, expect } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { LocaleProvider } from "@/components/locale-provider";
import Loading from "./loading";

const render = (locale?: "en" | "es") => renderToStaticMarkup(
  locale
    ? createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, createElement(Loading))
    : createElement(Loading),
);

// S-10 T9a: the Team skeleton used to render English (m["team.loading"], an
// English TeamSkeleton) for a Spanish reader — `loading.tsx` gets no
// params/searchParams at all, so it cannot call `requestLocale` the way
// team/page.tsx does; it reads the shell's own already-resolved locale from
// the account layout's LocaleProvider instead, the same idiom tasks/
// loading.tsx and documents/loading.tsx already use, with no new data read.
describe("the Team page's loading skeleton (S-10 T9a)", () => {
  it("in Spanish, the busy region is named \"Equipo\" with lang=\"es\", and the TeamSkeleton card reads Spanish (mutation: aria-label=\"Loading the team\" -> FAILS)", () => {
    const html = render("es");
    expect(html).toMatch(/<div[^>]*aria-busy="true"[^>]*aria-label="Equipo"/);
    expect(html).toMatch(/<div class="p-6"[^>]*lang="es"/);
    expect(html).toContain(m["team.body.es"]);
    expect(html).not.toContain("Loading the team");
    expect(html).not.toContain(">Team<");
  });

  it("in English (and with no provider at all), it is named \"Team\"", () => {
    expect(render("en")).toMatch(/aria-busy="true"[^>]*aria-label="Team"/);
    expect(render()).toMatch(/aria-busy="true"[^>]*aria-label="Team"/);
  });
});
