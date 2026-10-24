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
import type { ShellBusinessStatus } from "@/app/(dashboard)/dashboard/accounts/[accountId]/shell-actions";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/shell-data", () => ({ useShellData: () => null }));
vi.mock("@/app/(dashboard)/dashboard/accounts/[accountId]/business-status-actions", () => ({
  setBusinessStatusAction: vi.fn(),
  undoBusinessStatusAction: vi.fn(),
}));

const { BusinessStatusMenu, buildChangeToast, planMenu } = await import("./business-status-menu");

const TZ = "America/Chicago";
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
      "Abierto de nuevo. Su página de citas recibe citas como siempre. "
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

  it("\"all\": a ghost button, aria-haspopup=\"menu\", the accessible trigger name, and the caller's own visible content", () => {
    const html = render({ canChange: "all" });
    expect(html).toContain("<button");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain("aria-label=\"Change today&#x27;s status\"");
    expect(html).toContain(">Change<");
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
