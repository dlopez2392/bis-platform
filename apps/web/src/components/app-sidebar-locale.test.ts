import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "app-sidebar.tsx"), "utf8",
);

describe("app-sidebar nav labels resolve through the locale helper", () => {
  it("no longer looks up m[item.labelKey] or m[group.label] directly (mutation: revert to the raw m[...] lookup → FAILS, both patterns reappear)", () => {
    expect(src).not.toMatch(/m\[item\.labelKey\]/);
    expect(src).not.toMatch(/m\[group\.label\]/);
    expect(src).toMatch(/t\(m, item\.labelKey, locale\)/);
    expect(src).toMatch(/t\(m, group\.label, locale\)/);
  });
});

// Fix round 1, "Minor (do it)": the footer Settings/Dashboard link, the
// back-to-agency link, the wordmark and the collapse/expand aria-label were
// still reading m[...] directly, so their .es twins (added this round) were
// unreachable even once LocaleProvider mounted correctly. Same source-scan
// convention as the describe block above.
//
// F-087 fix round (finding 1, CI red): the footer's Settings/Dashboard
// links no longer carry the literal "nav.settings"/"nav.dashboard" keys at
// all — they read `settingsEntry.labelKey`/`topLevelEntry.labelKey` off the
// surface manifest (app-sidebar.tsx, F-087 part 1, owner ruling Q1), so the
// OLD literal-key assertions below could never pass again. Repinned to the
// labelKey read; the `not.toMatch(/m\["nav\./)` half still holds (and still
// matters — the mutation it guards against, reverting to a raw m[...]
// lookup, is unrelated to which read style resolves the KEY itself).
describe("app-sidebar's remaining shell.*/nav.* labels also resolve through t() (fix round 1, Minor)", () => {
  it("no longer looks up m[\"nav.settings\"], m[\"nav.dashboard\"], m[\"shell.backToAgency\"] or m[\"shell.brand\"] directly (mutation: revert any one back to the raw m[...] lookup → FAILS)", () => {
    expect(src).not.toMatch(/m\["nav\.settings"\]/);
    expect(src).not.toMatch(/m\["nav\.dashboard"\]/);
    expect(src).not.toMatch(/m\["shell\.backToAgency"\]/);
    expect(src).not.toMatch(/m\["shell\.brand"\]/);
    // F-087 part 1: the footer's Settings/Dashboard labelKeys are read off
    // the manifest entries (settingsEntry/topLevelEntry), not the literal
    // "nav.settings"/"nav.dashboard" strings — mutation: revert either read
    // back to a hard-coded key string → FAILS (the manifest indirection is
    // gone, which is exactly the "written a third time" duplication F-087
    // closed).
    expect(src).toMatch(/t\(m, settingsEntry\.labelKey, locale\)/);
    expect(src).toMatch(/t\(m, topLevelEntry\.labelKey, locale\)/);
    expect(src).toMatch(/t\(m, "shell\.backToAgency", locale\)/);
    expect(src).toMatch(/t\(m, "shell\.brand", locale\)/);
  });

  it("the collapse/expand aria-label also resolves through t(), not m[\"shell.collapse\"]/m[\"shell.expand\"] directly (mutation: revert to the raw m[...] lookup → FAILS)", () => {
    expect(src).not.toMatch(/m\["shell\.collapse"\]/);
    expect(src).not.toMatch(/m\["shell\.expand"\]/);
    expect(src).toMatch(/t\(m, "shell\.expand", locale\)/);
    expect(src).toMatch(/t\(m, "shell\.collapse", locale\)/);
  });
});

// Decision D (orchestrator, 2026-10-10): `lang` sits on the converted parts
// only. In the sidebar that is the scrolling <nav> (every nav label and
// group header resolves through t()) and the collapse/expand toggle (its
// aria-label does too) — never the <aside>, which also holds the account
// switcher and the client's brand name, neither of which is translated.
describe("app-sidebar puts lang on the translated parts only (decision D)", () => {
  it("the scrolling <nav> carries lang={locale} (mutation: drop it → FAILS)", () => {
    expect(src).toMatch(/<nav lang=\{locale\} className="-mx-3 /);
  });

  it("the collapse/expand toggle carries lang={locale}, since its aria-label is translated (mutation: drop it → FAILS)", () => {
    const toggle = src.slice(src.indexOf("onClick={toggle}") - 80, src.indexOf("onClick={toggle}") + 200);
    expect(toggle).toContain("lang={locale}");
  });

  it("the <aside> itself carries no lang (mutation: move lang={locale} onto the aside → FAILS)", () => {
    const asideOpen = src.slice(src.indexOf("<aside"), src.indexOf("<div", src.indexOf("<aside")));
    expect(asideOpen).not.toContain("lang=");
  });
});
