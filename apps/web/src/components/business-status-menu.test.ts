// S-47d Task 11 (plan "The topbar forms", spec §5.6.1): `planMenu` is the one source of truth for
// which items the menu shows — Radix's own `DropdownMenuContent`/`DropdownMenuSub` mount their items
// only while actually OPEN (`Presence`'s `present = forceMount || context.open`, confirmed against
// `@radix-ui/react-menu@2.1.24`'s own source at node_modules/.pnpm), so a CLOSED static server render
// can never show the open menu's content. `planMenu`'s return value is what decides that content, so
// it is the thing under test for "which items show"; `renderToStaticMarkup` below covers what a closed
// render actually DOES show — the trigger itself (always rendered, Presence only gates the content).
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ShellBusinessStatus } from "@/app/(dashboard)/dashboard/accounts/[accountId]/shell-actions";
import { m } from "@/lib/messages";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/shell-data", () => ({ useShellData: () => null }));
vi.mock("@/app/(dashboard)/dashboard/accounts/[accountId]/business-status-actions", () => ({
  setBusinessStatusAction: vi.fn(),
  undoBusinessStatusAction: vi.fn(),
}));

const { BusinessStatusMenu, buildChangeToast, planMenu, radioValue } = await import("./business-status-menu");

const TZ = "America/Chicago";
const menuSrc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "business-status-menu.tsx"), "utf8");
const OPEN_WIRE: ShellBusinessStatus["effective"] = { state: "open", nextClosedDay: null };
const CLOSED_TODAY_WIRE: ShellBusinessStatus["effective"] = {
  state: "closed_today", reopensAt: "2027-06-08T13:00:00.000Z", reopensTimeKnown: true,
};
const CLOSED_DAY_WIRE: ShellBusinessStatus["effective"] = {
  state: "closed_day", reason: "holiday", startsOn: "2027-06-07", endsOn: "2027-06-07",
  reopensAt: "2027-06-08T13:00:00.000Z", reopensTimeKnown: true,
};
const RUNNING_LATE_WIRE: ShellBusinessStatus["effective"] = {
  state: "running_late", lateMinutes: 30, endsAt: "2027-06-08T05:00:00.000Z",
};

function status(over: Partial<ShellBusinessStatus>): ShellBusinessStatus {
  return {
    effective: OPEN_WIRE, canChange: "all", timezone: TZ, personaName: null, now: "2027-06-07T15:00:00.000Z",
    ...over,
  };
}

describe("planMenu — the one source of truth for which items the menu shows (spec §5.6.1)", () => {
  it("null canChange: \"none\" (the caller renders the words only, no button)", () => {
    expect(planMenu(status({ canChange: null }))).toEqual({ kind: "none" });
  });

  it("\"late_only\": exactly the two-item plan, whatever the effective state (open or running late)", () => {
    expect(planMenu(status({ canChange: "late_only", effective: OPEN_WIRE }))).toEqual({ kind: "late_only" });
    expect(planMenu(status({ canChange: "late_only", effective: RUNNING_LATE_WIRE }))).toEqual({ kind: "late_only" });
  });

  it("\"all\" while open or closed_today: the full menu with an Open radio row (mutation: always \"link\" -> FAILS)", () => {
    expect(planMenu(status({ canChange: "all", effective: OPEN_WIRE }))).toEqual({ kind: "all", openRow: "open" });
    expect(planMenu(status({ canChange: "all", effective: CLOSED_TODAY_WIRE }))).toEqual({ kind: "all", openRow: "open" });
  });

  it("\"all\" during a closed day: Open is replaced by the closed-days link (mutation: always \"open\" -> FAILS)", () => {
    expect(planMenu(status({ canChange: "all", effective: CLOSED_DAY_WIRE }))).toEqual({ kind: "all", openRow: "link" });
  });
});

describe("buildChangeToast (spec §5.6.1, SD19)", () => {
  it("the state's own toast alone, no persona, no To-do", () => {
    expect(buildChangeToast({ state: "closed_today" }, 0, null, "en"))
      .toBe("Closed for today. Your booking page now says so.");
  });

  it("appends \"{persona} says so too.\" only when a persona name is known (SD19: never assumed)", () => {
    expect(buildChangeToast({ state: "closed_today" }, 0, "Sofía", "en"))
      .toBe("Closed for today. Your booking page now says so. Sofía says so too.");
    expect(buildChangeToast({ state: "closed_today" }, 0, null, "en"))
      .not.toContain("says so too");
  });

  it("appends the singular To-do sentence at exactly 1, the plural otherwise (mutation: always plural -> FAILS)", () => {
    expect(buildChangeToast({ state: "storm", backOn: null }, 1, null, "en"))
      .toBe("Closed for a storm. Your booking page now says so. A To-do lists the affected appointment.");
    expect(buildChangeToast({ state: "storm", backOn: null }, 3, null, "en"))
      .toBe("Closed for a storm. Your booking page now says so. A To-do lists the 3 affected appointments.");
  });

  it("no To-do sentence at zero", () => {
    expect(buildChangeToast({ state: "running_late", lateMinutes: 30 }, 0, null, "en"))
      .toBe("Running late today. Booking stays open.");
  });

  it("Spanish, persona and To-do together", () => {
    expect(buildChangeToast({ state: "open" }, 2, "Max", "es")).toBe(
      "Abierto de nuevo. Su página de citas acepta reservas como siempre. "
      + "Max también lo dice. Una tarea en Pendientes lista las 2 citas afectadas.",
    );
  });

  it("the pseudo-locale wraps the whole built string, not just the first piece (mutation: wrap only the base -> FAILS)", () => {
    const plain = buildChangeToast({ state: "closed_today" }, 1, "Max", "en", false);
    const pseudo = buildChangeToast({ state: "closed_today" }, 1, "Max", "en", true);
    expect(pseudo).not.toBe(plain);
    expect(pseudo.length).toBeGreaterThan(plain.length);
    // Every PIECE is independently wrapped (never the raw persona name or raw "1"
    // left unpseudofied in the middle of a pseudo-wrapped sentence).
    expect(pseudo).not.toContain("Max says so too.");
    expect(pseudo).not.toContain("the affected appointment.");
  });
});

function render(over: Partial<ShellBusinessStatus> = {}, trigger = "Change"): string {
  return renderToStaticMarkup(createElement(BusinessStatusMenu, {
    accountId: "a1", status: status(over), locale: "en", pseudo: false, trigger,
  }));
}

describe("BusinessStatusMenu — the closed (default) render: what renderToStaticMarkup CAN show", () => {
  it("null canChange: no button at all — the trigger's own content, unwrapped", () => {
    const html = render({ canChange: null });
    expect(html).toBe("Change");
    expect(html).not.toContain("<button");
  });

  // Fix round C2 (design review I2): an aria-label REPLACED the status words, so a screen reader heard
  // "Change today's status" and never "Closed today". The name is now the visible words followed by the
  // trigger phrase, an sr-only suffix.
  it("\"all\": a ghost button, aria-haspopup=\"menu\", NO aria-label, and the visible words followed by an sr-only trigger phrase (mutation: restore the aria-label -> FAILS)", () => {
    const html = render({ canChange: "all" }, "Closed today");
    expect(html).toContain("<button");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain("aria-label=");
    expect(html).toMatch(/>Closed today<span class="sr-only">, Change today&#x27;s status<\/span><\/button>/);
  });

  it("the card's \"action\" trigger (its own word, \"Change\") keeps the phrase as its name, the visible word inside it", () => {
    const html = renderToStaticMarkup(createElement(BusinessStatusMenu, {
      accountId: "a1", status: status({ canChange: "all" }), locale: "en", pseudo: false, trigger: "Change", triggerKind: "action",
    }));
    expect(html).toContain("aria-label=\"Change today&#x27;s status\"");
    expect(html).not.toContain("sr-only");
    expect(html).toContain(">Change<");
  });

  it("Spanish: the sr-only phrase is the catalogue's Spanish twin", () => {
    const html = renderToStaticMarkup(createElement(BusinessStatusMenu, {
      accountId: "a1", status: status({ canChange: "all" }), locale: "es", pseudo: false, trigger: "Cerrado hoy",
    }));
    expect(html).toContain('<span class="sr-only">, Cambiar el estado de hoy</span>');
  });

  // Fix round C1, measured on the built app (agency, Spanish, 2026-10-24): beside the agency's search icon
  // (32px), theme toggle (36), org switcher (56) and user button (28) with four 8px gaps, the indicator has
  // 60px at 320px wide and 100px at 360px. The idle "0 calls" content is 58px and "Cerrado hoy" 93px, so
  // ANY horizontal padding on a status trigger below sm overflows (px-2: 14-18px at 320, 9px at 360). Every
  // state's content is at least 44px wide, so the 44px tap target holds with none.
  it("a status trigger has no horizontal padding below sm, px-4 from sm, and keeps its 44px tap target (mutation: px-2 below sm -> FAILS)", () => {
    const html = render({ canChange: "all" });
    expect(html).toMatch(/class="[^"]*\bpx-0\b[^"]*\bsm:px-4\b/);
    expect(html).not.toMatch(/\bpx-2\b/);
    expect(html).toMatch(/class="[^"]*\bmin-h-11\b/);
  });

  it("the card's action trigger keeps the button's own padding (the topbar budget is not the card's)", () => {
    const html = renderToStaticMarkup(createElement(BusinessStatusMenu, {
      accountId: "a1", status: status({ canChange: "all" }), locale: "en", pseudo: false, trigger: "Change", triggerKind: "action",
    }));
    expect(html).not.toMatch(/(^|[\s"])(px-0|px-2|sm:px-4)(?=[\s"])/);
    expect(html).toMatch(/[\s"]px-4[\s"]/);
  });

  it("\"late_only\": the SAME trigger shape — canChange, not the menu's own content, decides whether a button renders", () => {
    const html = render({ canChange: "late_only" });
    expect(html).toContain("<button");
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("the trigger carries a visible focus ring (DESIGN.md DoD: focus ring visible; mutation: drop focus-visible:ring -> FAILS)", () => {
    const html = render({ canChange: "all" });
    expect(html).toMatch(/focus-visible:ring/);
  });

  it("the Storm date dialog is closed by default (no [role=dialog] content in the static markup)", () => {
    const html = render({ canChange: "all" });
    expect(html).not.toContain("role=\"dialog\"");
  });
});

/**
 * Fix round B5 (final M-4 = design I3): the radio group's value must be one of the items' own values, or
 * nothing is checked. "running_late" matched no item (they are running_late_15/30/60/120), and a dated
 * storm checked "Until further notice", which is the opposite of what is set.
 */
describe("radioValue — the checked item is the one that describes what is set", () => {
  it("running late checks its own delay (mutation: return \"running_late\" -> FAILS)", () => {
    expect(radioValue({ state: "running_late", lateMinutes: 30, endsAt: new Date("2027-06-08T05:00:00Z") })).toBe("running_late_30");
    expect(radioValue({ state: "running_late", lateMinutes: 120, endsAt: new Date("2027-06-08T05:00:00Z") })).toBe("running_late_120");
  });

  it("an open-ended storm checks \"Until further notice\"; a dated storm checks \"Back on a date…\", its own value (mutation: return \"storm\" for both -> FAILS)", () => {
    expect(radioValue({ state: "storm", reopensAt: null, reopensTimeKnown: false })).toBe("storm");
    expect(radioValue({ state: "storm", reopensAt: new Date("2027-06-10T13:00:00Z"), reopensTimeKnown: true })).toBe("storm_dated");
  });

  it("a closed day checks Closed today (spec: a closed day reads the same); open and closed today check themselves", () => {
    expect(radioValue({
      state: "closed_day", reason: null, startsOn: "2027-06-07", endsOn: "2027-06-07",
      reopensAt: new Date("2027-06-08T13:00:00Z"), reopensTimeKnown: true,
    })).toBe("closed_today");
    expect(radioValue({ state: "open", nextClosedDay: null })).toBe("open");
    expect(radioValue({ state: "closed_today", reopensAt: new Date("2027-06-08T13:00:00Z"), reopensTimeKnown: true })).toBe("closed_today");
  });

  it("every value radioValue can return is an item the menu renders (source pin: the late items' and the dated storm's own values)", () => {
    expect(menuSrc).toContain("value={`running_late_${opt.value}`}");
    expect(menuSrc).toMatch(/<DropdownMenuRadioItem\s+value="storm_dated"/);
    expect(menuSrc).toMatch(/<DropdownMenuRadioItem value="storm" /);
    expect(menuSrc).toMatch(/<DropdownMenuRadioItem value="closed_today" /);
    expect(menuSrc).toMatch(/<DropdownMenuRadioItem value="open" /);
  });
});

/** Fix round C3 (design review I4): every portaled overlay sets its own `lang`, since a portal leaves the
 *  `lang` of the wrapper that mounted it. D4: the storm dialog opens only after the menu has closed and
 *  hands focus back to the trigger. D10: one Undo window, imported. Source pins: Radix mounts none of
 *  these in a closed static render. */
describe("BusinessStatusMenu — overlays, the storm dialog and the Undo window (source pins)", () => {
  it("DropdownMenuContent, both DropdownMenuSubContent and DialogContent carry lang={locale} (mutation: drop any -> FAILS)", () => {
    expect(menuSrc.match(/<DropdownMenuContent\b[^>]*\blang=\{locale\}/g)?.length).toBe(1);
    expect(menuSrc.match(/<DropdownMenuSubContent lang=\{locale\}>/g)?.length).toBe(2);
    expect(menuSrc.match(/<DialogContent\b[^>]*\blang=\{locale\}/g)?.length).toBe(1);
  });

  it("the dated storm item lets the menu close and the dialog opens from onCloseAutoFocus; the dialog returns focus to the trigger (mutation: e.preventDefault() on the item's own onSelect -> FAILS)", () => {
    expect(menuSrc).not.toMatch(/onSelect=\{\(e\) => \{ e\.preventDefault\(\); setStormOpen\(true\); \}\}/);
    expect(menuSrc).toMatch(/onCloseAutoFocus=\{\(e\) => \{\s*if \(stormRequested\.current\)/);
    expect(menuSrc).toMatch(/<DialogContent[^>]*onCloseAutoFocus=\{\(e\) => \{ e\.preventDefault\(\); triggerRef\.current\?\.focus\(\); \}\}/);
  });

  it("the dialog is titled \"Closed for a storm\" with the description \"When do you reopen?\" (D4)", () => {
    expect(menuSrc).toContain('<DialogDescription>{tr.text("business.storm.description")}</DialogDescription>');
    expect(m["business.storm.title"]).toBe("Closed for a storm");
    expect(m["business.storm.title.es"]).toBe("Cerrado por tormenta");
    expect(m["business.storm.description"]).toBe("When do you reopen?");
    expect(m["business.storm.description.es"]).toBe("¿Cuándo vuelve a abrir?");
  });

  it("UNDO_WINDOW_MS is imported from calendar/undo-window.ts, never declared again here (D10; mutation: a local 10_000 -> FAILS)", () => {
    expect(menuSrc).toMatch(/import \{ UNDO_WINDOW_MS \} from "@\/app\/\(dashboard\)\/dashboard\/accounts\/\[accountId\]\/calendar\/undo-window";/);
    expect(menuSrc).not.toMatch(/const UNDO_WINDOW_MS/);
  });
});
