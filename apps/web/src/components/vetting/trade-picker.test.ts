import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The picker's list is PORTALED out of the form (Radix Select), so the `lang` TradeFields sets on its
 * wrapper never reaches the options a screen reader hears (design check I1). Radix renders nothing of
 * a closed list on the server, so the list's parts are stood in for by plain elements that keep the
 * props they are handed; the trigger is the real one.
 */
vi.mock("@/components/ui/select", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ui/select")>();
  const pass = (tag: string, slot: string) => {
    const StandIn = (p: Record<string, unknown> & { children?: ReactNode }) => {
      const { children, ...rest } = p;
      return createElement(tag, { "data-mock": slot, lang: rest.lang as string | undefined, className: rest.className as string | undefined }, children);
    };
    StandIn.displayName = `StandIn(${slot})`;
    return StandIn;
  };
  return {
    ...real,
    SelectContent: pass("div", "content"),
    SelectGroup: pass("div", "group"),
    SelectLabel: pass("div", "label"),
    SelectItem: pass("div", "item"),
  };
});

import { tradeOptionGroups } from "@/lib/vetting/copy";
import { TradePicker } from "./trade-picker";

const render = (locale: "en" | "es") => renderToStaticMarkup(createElement(TradePicker, {
  id: "t", name: "trade", groups: tradeOptionGroups(locale), value: "", onValueChange: () => {}, placeholder: "Pick", locale,
}));

describe("TradePicker", () => {
  it("sets lang on its portaled list, which sits outside the form's lang wrapper (mutation: drop lang from SelectContent -> FAILS)", () => {
    expect(render("es")).toContain('data-mock="content" lang="es"');
    expect(render("en")).toContain('data-mock="content" lang="en"');
  });

  it("lets a long trade wrap in the trigger instead of truncating it at 390px (design check M3; mutation: drop the wrap classes -> FAILS)", () => {
    const trigger = /<button[^>]*data-slot="select-trigger"[^>]*>/.exec(render("es"))?.[0] ?? "";
    expect(trigger).toContain("whitespace-normal");
    expect(trigger).not.toContain("whitespace-nowrap");
    expect(trigger).toContain("*:data-[slot=select-value]:line-clamp-none");
    expect(trigger).not.toContain("*:data-[slot=select-value]:line-clamp-1");
    expect(trigger).toContain("data-[size=default]:h-auto");
    expect(trigger).not.toContain("data-[size=default]:h-9");
  });
});
