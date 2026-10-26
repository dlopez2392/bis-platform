import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Imported at module scope by the composer; never called during a server render.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MessageComposer, composeModeFromHash, smsFormBlock, tabSwitch, modeAfterSend, hashTargetFor, resolveInitialMode } from "./message-composer";
import { m } from "@/lib/messages";
import { LocaleProvider } from "@/components/locale-provider";
import { renderedText } from "@/lib/rendered-text";

/**
 * D-015. Same defect as the Conversations EmailComposer
 * (../../conversations/email-composer.test.ts): the body field was a
 * single-line `<input>`, which cannot hold a typed Enter at all.
 *
 * `mode` defaults to "note" (`useState<Mode>("note")`) with no prop to pick
 * a starting mode, and the three modes' forms are driven by a `key={mode}`
 * remount sharing the exact same body field markup — so this one render,
 * in the default note mode, exercises the shared fix for email and sms too.
 */
function render(): string {
  return renderToStaticMarkup(createElement(MessageComposer, {
    contactId: "c1",
    contactHasEmail: true,
    contactHasPhone: true,
    smsGate: { ok: true, from: "+19565550000", ownedNumbers: ["+19565550000"] },
    smsBlockedLine: null,
    emailNoticeLine: null,
    noteAction: async () => {},
    emailAction: async () => {},
    smsAction: async () => {},
  } as never));
}

describe("MessageComposer's mode tabs (design check 1a, M1)", () => {
  it("are on the control radius, never rounded-md's off-scale 10px (mutation: put back rounded-md -> FAILS)", () => {
    const tabs = render().match(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>/g) ?? [];
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) {
      expect(tab).toContain("rounded-[var(--radius-ctl)]");
      expect(tab).not.toMatch(/\brounded-md\b/);
    }
  });

  // DESIGN DoD (phone tap targets): the Note/Email/Text tabs were a fixed
  // px-2.5 py-1, well under 44px — the record timeline's own min-h-11 md:min-h-8 idiom.
  it("are each at least 44px tall on a phone (mutation: drop min-h-11 from the tab -> FAILS)", () => {
    const tabs = render().match(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>/g) ?? [];
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) {
      expect(tab).toContain("min-h-11");
      expect(tab).toContain("md:min-h-8");
    }
  });
});

describe("MessageComposer's body field (D-015)", () => {
  it("renders the body as a textarea, not a single-line input (mutation: revert to <Input> → FAILS)", () => {
    const html = render();
    expect(html).toMatch(/<textarea[^>]*name="body"/);
    expect(html).not.toMatch(/<input[^>]*name="body"/);
  });
});

describe("the header's Text and Email land on the composer (S-03 part 1, spec §9.1)", () => {
  it("maps exactly the two hashes to their channels (mutation: return 'sms' for #compose-email -> FAILS)", () => {
    expect(composeModeFromHash("#compose-sms")).toBe("sms");
    expect(composeModeFromHash("#compose-email")).toBe("email");
    expect(composeModeFromHash("")).toBeNull();
    expect(composeModeFromHash("#record-who")).toBeNull();
    expect(composeModeFromHash("#compose-note")).toBeNull();
  });

  it("carries both anchors, so the links scroll to the composer even without JavaScript (mutation: drop an anchor -> FAILS)", () => {
    const html = render();
    expect(html).toContain('id="compose-sms"');
    expect(html).toContain('id="compose-email"');
  });
});

describe("smsFormBlock: the one line the Text tab shows instead of the form", () => {
  const open = { ok: true as const, from: "+19565550000", ownedNumbers: ["+19565550000"] };
  it("an unreadable gate fails CLOSED with the unknown line, never an open form (spec §7; mutation: treat null as open -> FAILS)", () => {
    expect(smsFormBlock(null, true, null)).toEqual({ text: m["compose.smsStateUnknown"], consent: false });
  });
  it("keeps today's order: gate, then number, then the consent line", () => {
    expect(smsFormBlock({ ok: false, reason: "a2p_not_approved" }, true, null)).toEqual({ text: m["compose.smsBlockedA2p"], consent: false });
    expect(smsFormBlock({ ok: false, reason: "no_live_number" }, true, null)).toEqual({ text: m["compose.smsBlockedNoNumber"], consent: false });
    expect(smsFormBlock(open, false, "held")).toEqual({ text: m["compose.noPhoneOnContact"], consent: false });
    expect(smsFormBlock(open, true, "held")).toEqual({ text: "held", consent: true });
    expect(smsFormBlock(open, true, null)).toBeNull();
  });
});

describe("smsFormBlock: a paused account (M7a PR-4, design review I5)", () => {
  const open = { ok: true as const, from: "+19565550000", ownedNumbers: ["+19565550000"] };
  it("a paused account's Text tab says texts are stopped BEFORE the A2P line, the gate's own order (gate.ts) (mutation: check paused after the gate → FAILS: the A2P line shows)", () => {
    expect(smsFormBlock({ ok: false, reason: "a2p_not_approved" }, true, null, "en", true)).toEqual({ text: m["compose.smsBlockedPaused"], consent: false });
    expect(smsFormBlock(open, true, null, "en", true)).toEqual({ text: m["compose.smsBlockedPaused"], consent: false });
    expect(smsFormBlock(open, true, null, "es", true)).toEqual({ text: m["compose.smsBlockedPaused.es"], consent: false });
    expect(smsFormBlock(open, true, null, "en", false)).toBeNull();
  });
  it("the composer renders the paused line in place of the Text form, so nothing is typed only to be refused at Send (mutation: drop accountPaused on the way to smsFormBlock → FAILS)", () => {
    const html = renderToStaticMarkup(createElement(MessageComposer, {
      contactId: "c1", contactHasEmail: true, contactHasPhone: true, smsGate: open, smsBlockedLine: null, emailNoticeLine: null,
      emailAction: async () => {}, smsAction: async () => {}, modes: ["sms", "email"], initialMode: "sms", accountPaused: true,
    } as never));
    expect(renderedText(html)).toContain(m["compose.smsBlockedPaused"]);
    expect(html).not.toContain("<textarea");
  });
});

describe("the composer in Spanish (S-03 1b, spec §10.2)", () => {
  it("smsFormBlock answers in the page's language (mutation: drop the locale -> English, FAILS)", () => {
    expect(smsFormBlock(null, true, null, "es")).toEqual({ text: "No se pudo revisar si puede recibir textos. Vuelva a cargar la página para intentar de nuevo.", consent: false });
    expect(smsFormBlock({ ok: true, from: "+19565550199", ownedNumbers: [] } as never, false, null, "es"))
      .toEqual({ text: "Este contacto no tiene número de teléfono.", consent: false });
  });
  it("its tabs read Spanish under a Spanish LocaleProvider (mutation: keep m[...] for the tab labels -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "es" } as never, createElement(MessageComposer, {
      contactId: "c1", contactHasEmail: true, contactHasPhone: true, smsGate: null, smsBlockedLine: null, emailNoticeLine: null,
      noteAction: async () => {}, emailAction: async () => {}, smsAction: async () => {},
    } as never)));
    for (const word of [">Nota<", ">Correo<", ">Texto<"]) expect(html).toContain(word);
  });
});

function inbox(initialMode: "sms" | "email", over: Record<string, unknown> = {}, locale: "en" | "es" = "en"): string {
  return renderToStaticMarkup(createElement(LocaleProvider, { locale } as never, createElement(MessageComposer, {
    contactId: "c1", contactHasEmail: true, contactHasPhone: true,
    smsGate: { ok: true, from: "+19565550000", ownedNumbers: ["+19565550000"] }, smsBlockedLine: null, emailNoticeLine: null,
    emailAction: async () => {}, smsAction: async () => {},
    modes: ["sms", "email"], initialMode, ...over,
  } as never)));
}
const tabs = (html: string) => [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]*)<\/button>/g)].map((x) => [x[2], x[1]]);

describe("the inbox's Text | Email composer (S-06 part 3, spec §6, G9, G31)", () => {
  it("two tabs, Text then Email, no Note, opening on the server's channel (mutation: ignore initialMode → Note-less first tab pressed, FAILS)", () => {
    expect(tabs(inbox("email"))).toEqual([["Text", "false"], ["Email", "true"]]);
    expect(tabs(inbox("sms"))).toEqual([["Text", "true"], ["Email", "false"]]);
    expect(inbox("email")).toContain('placeholder="Subject"');
  });
  it("the tab group says what it is, in the staff member's language (mutation: drop role=group → FAILS)", () => {
    expect(inbox("sms")).toMatch(/<div[^>]*role="group"[^>]*aria-label="Reply by"/);
    expect(inbox("sms", {}, "es")).toMatch(/<div[^>]*role="group"[^>]*aria-label="Responder por"/);
    expect(tabs(inbox("sms", {}, "es")).map(([label]) => label)).toEqual(["Texto", "Correo"]);
  });
  it("the tab group carries lang so a screen reader announces its label correctly (mutation: drop lang={locale} → FAILS)", () => {
    expect(inbox("sms")).toMatch(/<div[^>]*role="group"[^>]*lang="en"/);
    expect(inbox("sms", {}, "es")).toMatch(/<div[^>]*role="group"[^>]*lang="es"/);
  });
  it("opening on Text shows today's blocked line in place of the form (mutation: render the form anyway → FAILS)", () => {
    expect(renderedText(inbox("sms", { smsBlockedLine: "They stopped texts from you." }))).toContain("They stopped texts from you.");
    expect(inbox("sms", { smsBlockedLine: "They stopped texts from you." })).not.toContain("<textarea");
  });
  it("the record page's composer is unchanged: three tabs, Note first and pressed, no group label (mutation: default modes without note → FAILS)", () => {
    expect(tabs(render()).map(([label, pressed]) => [label, pressed])).toEqual([["Note", "true"], ["Email", "false"], ["Text", "false"]]);
    expect(render()).not.toContain('role="group"');
  });
});

describe("one tap switches, for this message only (spec §6 'Not sticky')", () => {
  it("tabSwitch: a different tab switches, the same tab does nothing, only the Note boundary clears the draft (mutation: clear on every switch → FAILS)", () => {
    expect(tabSwitch("sms", "email")).toEqual({ mode: "email", clearBody: false });
    expect(tabSwitch("sms", "sms")).toBeNull();
    expect(tabSwitch("note", "email")).toEqual({ mode: "email", clearBody: true });
  });
  it("modeAfterSend: back to the server's channel when one was given (the inbox), unchanged otherwise (the record) (G31; mutation: always initialMode ?? 'note' → the record jumps to Note, FAILS)", () => {
    expect(modeAfterSend("email", "sms")).toBe("sms");
    expect(modeAfterSend("email", undefined)).toBe("email");
  });
});

describe("hashTargetFor: the record header's deep links, gated to the tabs actually on screen (fix round 1)", () => {
  it("answers the hash's channel only when it is one of modes (mutation: drop the modes.includes gate → FAILS)", () => {
    expect(hashTargetFor("#compose-sms", ["note", "email", "sms"])).toBe("sms");
    expect(hashTargetFor("#compose-sms", ["email"])).toBeNull();
    expect(hashTargetFor("#compose-email", ["sms", "email"])).toBe("email");
    expect(hashTargetFor("#record-who", ["note", "email", "sms"])).toBeNull();
  });
});

describe("resolveInitialMode: the starting tab, clamped to what's actually on screen (fix round 1)", () => {
  it("keeps initialMode when it is one of modes (mutation: ignore initialMode entirely → FAILS)", () => {
    expect(resolveInitialMode(["sms", "email"], "email")).toBe("email");
  });
  it("falls back to Note when modes holds it and initialMode is absent or foreign (mutation: fall back to modes[0] even with note present → FAILS)", () => {
    expect(resolveInitialMode(["note", "email", "sms"], undefined)).toBe("note");
    expect(resolveInitialMode(["note", "email", "sms"], "sms" as never)).toBe("sms");
  });
  it("falls back to modes[0] when Note is not on screen and initialMode is foreign to modes (mutation: fall back to 'note' unconditionally → FAILS)", () => {
    expect(resolveInitialMode(["sms", "email"], undefined)).toBe("sms");
    expect(resolveInitialMode(["sms", "email"], "note" as never)).toBe("sms");
  });
});
