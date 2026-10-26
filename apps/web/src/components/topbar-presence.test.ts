// apps/web/src/components/topbar-presence.test.ts
import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { onCallText, TopbarPresence } from "./topbar-presence";
import { LocaleProvider } from "./locale-provider";
import type { ShellBusinessStatus } from "@/app/(dashboard)/dashboard/accounts/[accountId]/shell-actions";

// F-085 part 1 (spec §7.2): the snapshot TopbarPresence reads, set per test.
// Mocked at the hook so no server action module is loaded.
const shell = vi.hoisted(() => ({ snapshot: null as unknown }));
vi.mock("@/components/shell-data", () => ({ useShellData: () => shell.snapshot }));

// S-47d Task 11: TopbarPresence's OWN code decides whether to wrap the words in the menu at all
// (`!isIdle && businessStatus?.canChange`) — it never calls BusinessStatusMenu when canChange is null.
// Mocked here so this file tests ONLY that decision, not the menu's own rendering (business-status-
// menu.test.ts's job): the mock just proves IT WAS CALLED, with the trigger content, via a marker
// element a real `<button>` from the real component would also satisfy visually but this test can tell
// apart unambiguously.
vi.mock("@/components/business-status-menu", () => ({
  BusinessStatusMenu: (props: { trigger: ReactNode }) =>
    createElement("i", { "data-testid": "bsm-wrapped" }, props.trigger),
}));

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "topbar-presence.tsx"), "utf8");

// F-107 r4 review (item 1): below `sm` the full presence phrase does not
// fit in the topbar next to the icon-only search trigger, ThemeToggle,
// OrganizationSwitcher and UserButton — collapsed to "dot + short word"
// (rule 3: never a bare dot). Source pin, same convention as
// app-sidebar.test.ts: this component has no render harness.
describe("TopbarPresence — F-107 r4: dot + short word below `sm`, the full phrase at sm+", () => {
  it("both states wrap their two variants in one data-testid, not a bare Fragment (mutation: drop either `data-testid=\"topbar-presence\"` → FAILS) — the e2e sweep's own wait needs ONE unambiguous target, since both variants' text overlaps ('last 7 days' in both idle phrases)", () => {
    expect(src.match(/data-testid="topbar-presence"/g)?.length).toBe(2);
  });

  it("the on-call short word is rendered below `sm`, the full phrase at sm+ (mutation: drop `sm:hidden`/`hidden sm:flex` → FAILS)", () => {
    expect(src).toContain('<span className="flex items-center gap-1.5 text-sm text-foreground sm:hidden">');
    expect(src).toContain('<span className="hidden items-center gap-1.5 text-sm text-foreground sm:flex">');
    expect(src).toContain('t(m, "shell.presence.onCallShort", locale)');
  });

  it("the idle short word keeps a dot, never a bare glyph, below `sm` (mutation: drop the dot span or `sm:hidden`/`hidden sm:block` → FAILS)", () => {
    expect(src).toContain('<span className="flex items-center gap-1.5 text-sm text-muted-foreground sm:hidden">');
    expect(src).toContain('<span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--good)]" />');
    expect(src).toContain('<span className="hidden text-sm text-muted-foreground sm:block">');
  });
});

// F-107 r5 review (item 2, minor): "{count} this week" didn't say what was
// counted — "calls" restores that, matching the full phrase's own noun
// ("✓ {count} calls handled this week"). The short phrase needs its own
// singular pair for the same reason the full phrase already has one
// (idle/idleOne, above): "1 calls" is wrong, so a weekCount of exactly 1
// must route to idleShortOne, not idleShort with "{count}" substituted.
describe("TopbarPresence — F-107 r5: the idle short phrase names what's counted, with its own singular", () => {
  it("renders the singular key at weekCount === 1 and the plural key (count substituted) otherwise (mutation: always use idleShort.replace → FAILS, since weekCount 1 would read '1 calls' with no singular branch to catch it)", () => {
    expect(src).toContain(
      '        {presence.weekCount === 1\n'
      + '          ? t(m, "shell.presence.idleShortOne", locale)\n'
      + '          : t(m, "shell.presence.idleShort", locale, { count: presence.weekCount })}',
    );
  });
});

// Task 6 (Spanish-runtime lane): the on-call/idle phrases used to read
// `m["shell.presence.*"]` straight off the English catalogue regardless of
// which locale the account resolved to — this is the first place the
// `.es` twins already sitting in messages.ts (onCallShort/idleShort/
// idleShortOne) become reachable. Source pin, same convention as the rest
// of this file: no render harness exists for this component.
describe("TopbarPresence resolves shell.presence.* through useLocale()/t(), not a hard-coded .en lookup", () => {
  it("reads locale from useLocale() and routes every short-form presence string through t() (mutation: revert to the raw m[\"...én\"] lookups → FAILS, all three patterns reappear)", () => {
    expect(src).toMatch(/const locale = useLocale\(\);/);
    expect(src).not.toMatch(/m\["shell\.presence\.onCallShort\.en"\]/);
    expect(src).not.toMatch(/m\["shell\.presence\.idleShort\.en"\]/);
    expect(src).not.toMatch(/m\["shell\.presence\.idleShortOne\.en"\]/);
    expect(src).toMatch(/t\(m, "shell\.presence\.onCallShort", locale\)/);
    expect(src).toMatch(/t\(m, "shell\.presence\.idleShortOne", locale\)/);
    expect(src).toMatch(/t\(m, "shell\.presence\.idleShort", locale, \{ count: presence\.weekCount \}\)/);
  });
});

/**
 * D-063 follow-up (coordinator, cheap/minor): hard-coding "Sofía" in
 * topbar-presence.tsx passed every existing test in this repo — there was
 * none reaching this component at all. `onCallText` is the pure function
 * pulled out of TopbarPresence specifically so this has a test seam without
 * needing a render harness (the repo has no .tsx test convention today).
 */
describe("onCallText", () => {
  it("names the account's OWN configured persona (mutation: hard-code 'Sofía' → FAILS)", () => {
    expect(onCallText("Max")).toBe("Max · on a call");
  });

  it("falls back to 'Sofía' when the persona name is missing", () => {
    expect(onCallText(null)).toBe("Sofía · on a call");
    expect(onCallText(undefined)).toBe("Sofía · on a call");
  });

  it("falls back to 'Sofía' when the persona name is blank (whitespace only)", () => {
    expect(onCallText("   ")).toBe("Sofía · on a call");
  });

  it("trims surrounding whitespace off a real persona name", () => {
    expect(onCallText("  Max  ")).toBe("Max · on a call");
  });

  it("does not re-interpret '$&' in a persona name as a replacement pattern", () => {
    // String.replace treats a STRING second argument as a pattern ($&, $1,
    // …); a function second argument never is. A persona containing one of
    // those sequences must appear verbatim.
    expect(onCallText("Bob's $& Shop")).toBe("Bob's $& Shop · on a call");
  });
});

// Decision D (orchestrator, 2026-10-10): the presence phrase is translated,
// so its wrapper — in both states — carries the resolved locale as `lang`.
describe("TopbarPresence carries lang={locale} on its translated wrapper (decision D)", () => {
  it("both states' data-testid wrappers carry lang={locale} (mutation: drop it from either → FAILS)", () => {
    expect(src.match(/<span data-testid="topbar-presence" lang=\{locale\}>/g)?.length).toBe(2);
  });
});

/**
 * F-085 part 1 (spec §7.2): "N calls handled in the last 7 days" is the ACCOUNT's
 * total. A Technician (showCount false) keeps the on-a-call pulse, which says
 * nothing about anyone's customers, and gets nothing at all when idle.
 */
describe("TopbarPresence and showCount", () => {
  const render = (presence: object) => {
    shell.snapshot = { unreadTotal: 0, setup: null, presence };
    return renderToStaticMarkup(createElement(TopbarPresence));
  };

  it("idle with showCount false renders nothing (mutation: ignore showCount -> FAILS)", () => {
    expect(render({ onCall: false, personaName: "Sofía", showCount: false })).toBe("");
  });

  it("on a call with showCount false still shows the pulse, with no count", () => {
    const html = render({ onCall: true, personaName: "Sofía", showCount: false });
    expect(html).toContain('data-testid="topbar-presence"');
    expect(html).toContain("animate-pulse");
    expect(html).not.toMatch(/last 7 days/);
  });

  it("idle with showCount true still says the week's count", () => {
    expect(render({ onCall: false, weekCount: 12, personaName: "Sofía", showCount: true })).toContain("12");
  });
});

/**
 * S-47d Task 11 (plan "The topbar forms", spec §5.6.1, S15): the one switch's own words replace the
 * idle count when the business is not open, for everyone — and the indicator becomes the switch's own
 * menu trigger only when `canChange` is set.
 */
function bstatus(
  effective: ShellBusinessStatus["effective"], canChange: ShellBusinessStatus["canChange"],
): ShellBusinessStatus {
  return { effective, canChange, timezone: "America/Chicago", personaName: null, now: "2027-06-07T15:00:00.000Z" };
}

const CLOSED_TODAY: ShellBusinessStatus["effective"] = {
  state: "closed_today", reopensAt: "2027-06-08T13:00:00.000Z", reopensTimeKnown: true,
};
const RUNNING_LATE_30: ShellBusinessStatus["effective"] = {
  state: "running_late", lateMinutes: 30, endsAt: "2027-06-08T05:00:00.000Z",
};
const STORM_NO_DATE: ShellBusinessStatus["effective"] = { state: "storm", reopensAt: null, reopensTimeKnown: false };
const OPEN: ShellBusinessStatus["effective"] = { state: "open", nextClosedDay: null };

function renderWith(presence: object | null, businessStatus: ShellBusinessStatus | null, locale: "en" | "es" = "en") {
  shell.snapshot = { unreadTotal: 0, setup: null, presence, businessStatus, accountId: "a1" };
  const tree = createElement(TopbarPresence);
  return renderToStaticMarkup(locale === "es" ? createElement(LocaleProvider, { locale: "es" } as never, tree) : tree);
}

describe("TopbarPresence — not open, for everyone (spec §5.6.1)", () => {
  it("Closed today, English: full form carries the opens phrase, short form does not (no profile, no canChange: no button)", () => {
    const html = renderWith(null, bstatus(CLOSED_TODAY, null));
    expect(html).toContain("Closed today · opens 8 AM");
    expect(html).toContain(">Closed today<");
    expect(html).not.toContain("bsm-wrapped");
  });

  it("Closed today, Spanish: both forms through the catalogue's Spanish twin", () => {
    const html = renderWith(null, bstatus(CLOSED_TODAY, null), "es");
    expect(html).toContain("Cerrado hoy · abre a las 8 AM");
    expect(html).toContain(">Cerrado hoy<");
  });

  it("Running about 30 min late, English and Spanish", () => {
    expect(renderWith(null, bstatus(RUNNING_LATE_30, null))).toContain("Running about 30 min late");
    expect(renderWith(null, bstatus(RUNNING_LATE_30, null), "es")).toContain("Con unos 30 min de retraso");
  });

  it("Closed for a storm (no date), short and full forms identical", () => {
    const html = renderWith(null, bstatus(STORM_NO_DATE, null));
    expect(html).toContain(">Closed for a storm<");
  });

  it("a Technician (canChange null) still sees the words, never a button — the policy decides who may act, never who may SEE (mutation: gate on canChange before rendering the words at all -> FAILS)", () => {
    const html = renderWith(null, bstatus(CLOSED_TODAY, null));
    expect(html).toContain("Closed today");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("bsm-wrapped");
  });

  it("an Owner or the agency (canChange \"all\") gets the switch's menu as the indicator's own trigger (mutation: always render plain words -> FAILS)", () => {
    const html = renderWith(null, bstatus(CLOSED_TODAY, "all"));
    expect(html).toContain("bsm-wrapped");
    expect(html).toContain("Closed today");
  });

  it("Staff (canChange \"late_only\") ALSO gets the menu while running late", () => {
    const html = renderWith(null, bstatus(RUNNING_LATE_30, "late_only"));
    expect(html).toContain("bsm-wrapped");
  });
});

describe("TopbarPresence — during a call (fix round B1, spec S15)", () => {
  const ON_CALL = { onCall: true, weekCount: 3, personaName: "Max", showCount: true };

  it("canChange set, Open: the pulse and \"Max · on a call\" ARE the menu's trigger (mutation: render the on-call pulse bare -> FAILS)", () => {
    const html = renderWith(ON_CALL, bstatus(OPEN, "all"));
    expect(html).toMatch(/<i data-testid="bsm-wrapped"><span data-testid="topbar-presence"/);
    expect(html).toContain("animate-pulse");
    expect(html).toContain("Max · on a call");
  });

  it("canChange set, closed: the pulse plus the status, both inside the trigger", () => {
    const html = renderWith(ON_CALL, bstatus(CLOSED_TODAY, "all"));
    expect(html).toContain("bsm-wrapped");
    expect(html).toContain("Max · on a call");
    expect(html).toContain("Closed today");
  });

  it("no canChange (a Technician on a call): the pulse and the words, never a button", () => {
    const html = renderWith({ onCall: true, personaName: "Max", showCount: false }, bstatus(CLOSED_TODAY, null));
    expect(html).not.toContain("bsm-wrapped");
    expect(html).toContain("animate-pulse");
  });
});

/**
 * Fix round C1 (design review I1): the full closed-state form is up to 325px in Spanish (a dated storm)
 * and 402px in the pseudo-locale, and only ~170px is left for it at `lg` beside the 300px search, the
 * theme toggle, the agency's org switcher and the user button. The SHORT form therefore holds up to `xl`
 * (1280px, ~430px left), in both the not-open words and the status that follows the on-call pulse.
 */
describe("TopbarPresence — the full status form only from xl (fix round C1)", () => {
  it("the closed words: the short form below xl, the full form at xl and up (mutation: switch back at sm -> FAILS)", () => {
    const html = renderWith(null, bstatus(CLOSED_TODAY, null));
    expect(html).toMatch(/<span class="flex items-center gap-1\.5 text-sm text-foreground xl:hidden"><span aria-hidden="true" class="size-2 shrink-0 rounded-full bg-\[var\(--crit\)\]"><\/span>Closed today<\/span>/);
    expect(html).toMatch(/<span class="hidden items-center gap-1\.5 text-sm text-foreground xl:flex"><span aria-hidden="true" class="size-2 shrink-0 rounded-full bg-\[var\(--crit\)\]"><\/span>Closed today · opens 8 AM<\/span>/);
  });

  it("on a call: the short status follows the pulse from sm, the full status only from xl", () => {
    const html = renderWith({ onCall: true, personaName: "Max", showCount: false }, bstatus(CLOSED_TODAY, null));
    expect(html).toMatch(/<span class="hidden xl:inline"> · Closed today · opens 8 AM<\/span>/);
    expect(html).toMatch(/<span class="xl:hidden"> · Closed today<\/span>/);
  });
});

describe("TopbarPresence — Open (spec §5.6.1)", () => {
  // Fix round B1 (spec S15/D7, plan Task 11): the indicator is the menu's trigger WHENEVER canChange is
  // set, Open included. This case used to pin the opposite (the idle count bypassing the menu), which left
  // every account with an enabled voice profile — 3 of 3 on production — with no topbar switch at all.
  it("with an enabled voice profile and canChange \"all\", the idle count IS the menu's trigger, its words unchanged (mutation: render the idle count bare -> FAILS)", () => {
    const html = renderWith({ onCall: false, weekCount: 3, personaName: "Sofía", showCount: true }, bstatus(OPEN, "all"));
    expect(html).toContain("bsm-wrapped");
    expect(html).toContain("last 7 days");
    expect(html).toMatch(/<i data-testid="bsm-wrapped"><span data-testid="topbar-presence"/);
  });

  it("Staff (canChange \"late_only\") while Open: the idle count is the trigger of their two-item menu", () => {
    const html = renderWith({ onCall: false, weekCount: 3, personaName: "Sofía", showCount: true }, bstatus(OPEN, "late_only"));
    expect(html).toContain("bsm-wrapped");
  });

  it("the idle count with NO canChange (a Technician never has showCount, but the read failing does): plain words, no menu", () => {
    const html = renderWith({ onCall: false, weekCount: 3, personaName: "Sofía", showCount: true }, null);
    expect(html).not.toContain("bsm-wrapped");
    expect(html).toContain("last 7 days");
  });

  it("a profile with no count (showCount false) and canChange set: \"● Open\" as the trigger, never nothing (mutation: return null when presence has no count -> FAILS)", () => {
    const html = renderWith({ onCall: false, personaName: "Sofía", showCount: false }, bstatus(OPEN, "all"));
    expect(html).toContain("bsm-wrapped");
    expect(html).toContain(">Open<");
    expect(html).not.toContain("last 7 days");
  });

  it("a profile with no count and no canChange: nothing, as before", () => {
    expect(renderWith({ onCall: false, personaName: "Sofía", showCount: false }, bstatus(OPEN, null))).toBe("");
  });

  it("no enabled profile (presence null) and canChange set: \"● Open\" as the menu's own trigger (mutation: render nothing -> FAILS)", () => {
    const html = renderWith(null, bstatus(OPEN, "all"));
    expect(html).toContain("bsm-wrapped");
    expect(html).toContain(">Open<");
  });

  it("no enabled profile and no canChange (a Technician): nothing at all, as before this task", () => {
    expect(renderWith(null, bstatus(OPEN, null))).toBe("");
  });

  it("no business-status read at all (the leg failed): degrades to today's behaviour exactly (nothing, no profile)", () => {
    expect(renderWith(null, null)).toBe("");
  });
});
