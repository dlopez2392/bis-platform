import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { AccountNameFields, typeBusinessName, typeBrandName, NAMES_START } from "./account-name-fields";

// Owner decision 2026-10-09: Add company asks for the name customers see as
// its own required field, pre-filled from the business name while the agency
// types, until they edit it. The business name stays their private label.

describe("the brand name follows the business name until it is edited", () => {
  it("copies each keystroke of the business name while untouched (mutation: never copy → FAILS)", () => {
    let s = typeBusinessName(NAMES_START, "Rio");
    s = typeBusinessName(s, "Rio Roofing");
    expect(s).toEqual({ businessName: "Rio Roofing", brandName: "Rio Roofing", brandEdited: false });
  });

  it("stops copying once the brand name has been edited (mutation: keep copying → FAILS)", () => {
    let s = typeBusinessName(NAMES_START, "Rio Roofing");
    s = typeBrandName(s, "Rio Roofing & Gutters");
    s = typeBusinessName(s, "Rio Roofing — trial");
    expect(s).toEqual({ businessName: "Rio Roofing — trial", brandName: "Rio Roofing & Gutters", brandEdited: true });
  });
});

describe("AccountNameFields", () => {
  const html = renderToStaticMarkup(createElement(AccountNameFields));

  it("posts both names, each required, under the labels and hint the owner asked for (mutation: drop the field or its required → FAILS)", () => {
    expect(html).toMatch(/<input[^>]*name="name"[^>]*required|<input[^>]*required[^>]*name="name"/);
    expect(html).toMatch(/<input[^>]*name="brandName"[^>]*required|<input[^>]*required[^>]*name="brandName"/);
    const text = renderedText(html);
    expect(text).toContain(m["accounts.name"]);
    expect(text).toContain(m["accounts.brandName"]);
    expect(text).toContain(m["accounts.brandNameHint"]);
  });

  it("the hint says where the name shows and that the business name stays private", () => {
    expect(m["accounts.brandNameHint"]).toMatch(/emails/i);
    expect(m["accounts.brandNameHint"]).toMatch(/texts/i);
    expect(m["accounts.brandNameHint"]).toMatch(/booking page/i);
    expect(m["accounts.brandNameHint"]).toMatch(/sidebar/i);
    expect(m["accounts.brandNameHint"]).toMatch(/private/i);
  });
});

describe("the setup rename step's help agrees with Add company", () => {
  it("no longer claims the brand name started as a copy of the private label (mutation: restore the old help → FAILS)", () => {
    expect(m["setup.rename.help"]).not.toMatch(/copy/i);
    expect(m["setup.rename.help"]).toMatch(/Branding/);
  });
});
