import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PhoneNumberRow, VoiceProfileRow } from "@bis/db";

/**
 * The number status Select under the S-53 vetting lock (final review M1, design check M1). Radix renders
 * nothing of a closed list on the server, so the Select's parts are stood in for by plain elements that
 * keep the props this panel hands them: what is under test is which options PhoneNumbersPanel disables,
 * what they say, and what the trigger points at - not Radix. Its own file, so the stand-ins never reach
 * voice-settings.test.ts's render proofs of the real Selects.
 */
vi.mock("@/components/ui/select", () => {
  const el = (tag: string) => {
    const StandIn = (p: Record<string, unknown> & { children?: ReactNode }) => {
      const { children, ...rest } = p;
      const attrs: Record<string, unknown> = {};
      for (const k of ["value", "disabled", "aria-describedby", "className"]) if (rest[k] !== undefined) attrs[k] = rest[k];
      return createElement(tag, attrs, children);
    };
    StandIn.displayName = `StandIn(${tag})`;
    return StandIn;
  };
  return {
    Select: el("div"), SelectTrigger: el("button"), SelectValue: () => null,
    SelectContent: el("ul"), SelectItem: el("li"), SelectGroup: el("div"), SelectLabel: el("div"),
  };
});

import { m } from "@/lib/messages";
import { PhoneNumbersPanel, type VettingLock } from "./voice-settings";

const PROFILE = { enabled: true, concierge_enabled: false } as VoiceProfileRow;
const number = (status: PhoneNumberRow["status"]) =>
  ({ id: "p1", account_id: "a1", e164: "+15555550100", telnyx_id: null, status }) as PhoneNumberRow;
const ES_LOCK: VettingLock = { text: "Sofía y el chat del sitio web aún no están disponibles para el giro restaurante.", link: null, locale: "es" };
const noop = async () => ({ ok: true as const });
const render = (status: PhoneNumberRow["status"], vettingLock: VettingLock | null) => renderToStaticMarkup(createElement(PhoneNumbersPanel, {
  numbers: [number(status)], assignAction: noop, statusAction: noop, vettingLock, profile: PROFILE,
}));
const option = (html: string, v: string) => new RegExp(`<li value="${v}"[^>]*>(.*?)</li>`).exec(html);

describe("PhoneNumbersPanel's status Select under the vetting lock", () => {
  it("disables the statuses that would put Sofía on the phone, and says so in the lock's language (mutation: drop disabled, or drop the word -> FAILS)", () => {
    const html = render("provisioned", ES_LOCK);
    for (const v of ["testing", "live"]) {
      expect(option(html, v)?.[0], v).toContain('disabled=""');
      expect(option(html, v)?.[1], v).toContain(`<span lang="es"> — ${m["vetting.numberStatusLocked.es"]}</span>`);
    }
    for (const v of ["provisioned", "released"]) {
      expect(option(html, v)?.[0], v).not.toContain('disabled=""');
      expect(option(html, v)?.[1], v).toBe(m[`voice.numbers.status.${v}` as keyof typeof m]);
    }
  });

  it("points the trigger at the reason sentence while any of its options is locked (mutation: drop aria-describedby -> FAILS)", () => {
    const html = render("provisioned", ES_LOCK);
    expect(html).toMatch(/<button aria-describedby="number-vetting-reason"/);
    expect(html).toContain('<p id="number-vetting-reason" lang="es"');
  });

  it("locks nothing, and points at nothing, without a lock or when no choice switches Sofía on (control)", () => {
    const unlocked = render("provisioned", null);
    expect(unlocked).not.toContain('disabled=""');
    expect(unlocked).not.toContain("aria-describedby");
    // A testing number is already answering: no status choice takes it from off to on.
    const answering = render("testing", ES_LOCK);
    expect(answering).not.toContain('disabled=""');
    expect(answering).not.toContain("aria-describedby");
  });
});
