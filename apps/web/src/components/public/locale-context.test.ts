import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicLocaleProvider, usePublicLocaleDefault } from "./locale-context";

function Reader() {
  const locale = usePublicLocaleDefault();
  return createElement("span", null, locale);
}

describe("PublicLocaleProvider / usePublicLocaleDefault", () => {
  it("threads the layout's resolved lang down to a consumer with no props", () => {
    const es = renderToStaticMarkup(
      createElement(PublicLocaleProvider, { lang: "es" }, createElement(Reader)),
    );
    expect(es).toContain(">es<");
  });

  it("defaults to en when rendered with no provider (should not happen in practice)", () => {
    // MUTATION: default the context to "es" instead -- this FAILS, since
    // every real [publicId] layout provides an explicit value and a stray
    // Provider-less render should fall back to the SAME default the rest of
    // this route tree uses when it knows nothing.
    const bare = renderToStaticMarkup(createElement(Reader));
    expect(bare).toContain(">en<");
  });
});
