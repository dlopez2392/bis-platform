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

/**
 * m3 (review fix round): the ORIGINAL version of this test anchored on
 * `aria-busy="true"[^>]*aria-label="Equipo"` with no tag boundary, which
 * `[^>]*` happily matched across the whole rendered string's FIRST such
 * pair — the nested TeamSkeleton Card's own
 * `aria-busy="true" aria-label="Equipo"`, not the outer `<div class="p-6">`
 * this file actually owns. Removing the outer region's own aria-label
 * entirely still left the Card's, so that mutation passed undetected.
 * `outerTag` anchors on the start of the string, which only the OUTER
 * div's own opening tag can match.
 */
const outerTag = (html: string): string => /^<div class="p-6"[^>]*>/.exec(html)?.[0] ?? "";

// S-10 T9a: the Team skeleton used to render English (m["team.loading"], an
// English TeamSkeleton) for a Spanish reader — `loading.tsx` gets no
// params/searchParams at all, so it cannot call `requestLocale` the way
// team/page.tsx does; it reads the shell's own already-resolved locale from
// the account layout's LocaleProvider instead, the same idiom tasks/
// loading.tsx and documents/loading.tsx already use, with no new data read.
describe("the Team page's loading skeleton (S-10 T9a)", () => {
  it("in Spanish, the OUTER p-6 region itself (not a nested card) carries lang and the busy region's own aria-label (mutation: drop the outer aria-label -> FAILS)", () => {
    const html = render("es");
    const tag = outerTag(html);
    expect(tag, html).not.toBe("");
    expect(tag).toContain('lang="es"');
    expect(tag).toContain('aria-busy="true"');
    expect(tag).toContain(`aria-label="${m["team.loading.es"]}"`);
    // The nested TeamSkeleton card reads Spanish too, but that is a
    // SEPARATE claim from the outer region's own label.
    expect(html).toContain(m["team.body.es"]);
    expect(html).not.toContain(m["team.loading"]);
    expect(html).not.toContain(">Team<");
  });

  it("in English (and with no provider at all), the outer region is named \"Loading the team\" (mutation: swap in team.title -> FAILS)", () => {
    for (const html of [render("en"), render()]) {
      const tag = outerTag(html);
      expect(tag, html).not.toBe("");
      expect(tag).toContain('lang="en"');
      expect(tag).toContain(`aria-label="${m["team.loading"]}"`);
    }
  });
});
