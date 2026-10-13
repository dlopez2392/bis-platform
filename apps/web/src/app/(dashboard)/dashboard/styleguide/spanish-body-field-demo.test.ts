import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SpanishBodyFieldDemo } from "./spanish-body-field-demo";
import { m } from "@/lib/messages";

// The styleguide page is a server component; SpanishBodyField is a client component whose
// composeEs prop is a function, which React cannot serialise across that boundary (CI e2e:
// "Functions cannot be passed directly to Client Components"). The demo owns composeEs.
describe("styleguide: the Spanish box demo", () => {
  const html = renderToStaticMarkup(createElement(SpanishBodyFieldDemo));
  it("renders our Spanish, stale and emptied (mutation: drop a state -> FAILS)", () => {
    expect(html.match(/name="body_es"/g)).toHaveLength(3);
    expect(html).toContain(">Gracias por su visita.</textarea>");
    expect(html).toContain(m["automations.bodyEs.stale"]);
    expect(html).toContain(m["automations.bodyEs.emptied"]);
  });
  it("the server page passes no composeEs function itself (mutation: inline the fields back into page.tsx -> FAILS)", () => {
    const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    expect(page).not.toMatch(/composeEs=/);
  });
});
