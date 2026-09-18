import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResolvedZone } from "@bis/db";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

// `next/link` renders a plain anchor under a static render — enough for the
// only thing asserted about it here, which is whether an href to Settings
// reaches the markup at all.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

const { ZoneNote } = await import("./zone-note");

function render(zone: ResolvedZone, isAgency: boolean): string {
  return renderToStaticMarkup(
    createElement(ZoneNote, { zone, isAgency, accountId: "acct1" }),
  );
}

/** The shared helper (lib/rendered-text.ts). This file's own local copy
 * documented the apostrophe trap and the sibling spec written the same hour
 * hit it anyway — so there is one implementation now, not one per file. */
const plain = renderedText;

const CONFIGURED: ResolvedZone = {
  zone: "America/Chicago", guessed: false,
  label: "America/Chicago", source: "account",
};
const FROM_AGENCY: ResolvedZone = {
  zone: "America/Chicago", guessed: true,
  label: "America/Chicago", source: "agency",
};
const FROM_FALLBACK: ResolvedZone = {
  zone: "UTC", guessed: true, label: "UTC", source: "fallback",
};

/**
 * The note names the zone on EVERY screen that prints a date in it, guessed
 * or not.
 *
 * The defect being closed was never that UTC appeared — it was that UTC
 * appeared SILENTLY, so whoever read the screen took it for local time. A
 * note that only appeared when something was wrong would leave the ordinary
 * case exactly as mute as before.
 */
describe("ZoneNote — the zone is always named", () => {
  it("names a correctly-configured zone (mutation: render the label only when `guessed` -> FAILS)", () => {
    const html = render(CONFIGURED, true);
    expect(plain(html)).toContain(m["zone.note"].replace("{zone}", "America/Chicago"));
  });

  it("prints `label`, never `zone` (mutation: print zone.zone instead of zone.label -> FAILS)", () => {
    // A HAND-BUILT divergence, deliberately. `resolveZone` sets `label`
    // identical to `zone` on all three branches today, so a fixture taken
    // from it cannot tell the two fields apart and a test named for this
    // mutation would be unfalsifiable — the exact shape this repo keeps
    // deleting. The COMPONENT's contract is still "print the label", and
    // this is what holds it to that if the two ever diverge.
    const divergent: ResolvedZone = {
      zone: "UTC", guessed: true, label: "America/Chicago", source: "fallback",
    };
    const html = render(divergent, true);
    expect(plain(html)).toContain(m["zone.note"].replace("{zone}", "America/Chicago"));
    expect(plain(html)).not.toContain(m["zone.note"].replace("{zone}", "UTC"));
  });
});

/**
 * DESIGN.md rule 3: status is never colour alone — dot + word. Here the
 * whole marker is words. These assertions are what stop the note from
 * degenerating into a tinted box that means something only to whoever wrote
 * it.
 */
describe("ZoneNote — a guess is announced in WORDS, never by colour alone", () => {
  it("says which setting is broken when the agency's zone was used (mutation: collapse `source` and always emit the fallback sentence -> FAILS)", () => {
    const html = render(FROM_AGENCY, true);
    expect(plain(html)).toContain(m["zone.guessed.agency"]);
    expect(plain(html)).not.toContain(m["zone.guessed.fallback"]);
  });

  it("says BOTH settings are broken when even the agency's zone was unusable (mutation: emit the agency sentence for every guess -> FAILS)", () => {
    const html = render(FROM_FALLBACK, true);
    expect(plain(html)).toContain(m["zone.guessed.fallback"]);
    expect(plain(html)).not.toContain(m["zone.guessed.agency"]);
  });

  it("stays silent about guessing when nothing was guessed (mutation: render the sentence unconditionally -> FAILS)", () => {
    const html = render(CONFIGURED, true);
    expect(plain(html)).not.toContain(m["zone.guessed.agency"]);
    expect(plain(html)).not.toContain(m["zone.guessed.fallback"]);
    expect(plain(html)).not.toContain(m["zone.guessed.client"]);
    expect(plain(html)).not.toContain(m["zone.guessed.fix"]);
  });

  it("EVERY guessed state says materially more in words than the configured one (mutation: render null in either guessed branch -> FAILS)", () => {
    // Rule 3 stated as something that can actually fail. The sibling tests
    // above check that a PARTICULAR sentence is present; this one checks
    // there is no combination of source and reader where `guessed` changes
    // only the tint. Strip every tag and class first: what is left is what a
    // reader with no colour perception, or a screen-reader user, receives.
    for (const zone of [FROM_AGENCY, FROM_FALLBACK]) {
      for (const isAgency of [true, false]) {
        const guessedText = plain(render(zone, isAgency)).replace(/\s+/g, " ").trim();
        const configuredText = plain(render(CONFIGURED, isAgency)).replace(/\s+/g, " ").trim();
        // A whole sentence longer, not a word or two — a tint plus a stray
        // space must not be able to satisfy this.
        expect(guessedText.length).toBeGreaterThan(configuredText.length + 30);
      }
    }
  });
});

/**
 * Settings is `requireAgencyOnlyAccountAccess`. Calls, Call detail, the
 * account dashboard and the work queue are all reachable by a CLIENT, so the
 * fix offered has to differ by reader: a client who followed a Settings link
 * would be redirected straight back to their own dashboard, which is a worse
 * answer than no link at all.
 */
describe("ZoneNote — the fix matches the reader", () => {
  it("offers the agency a link to Settings (mutation: drop the link -> FAILS)", () => {
    const html = render(FROM_AGENCY, true);
    expect(plain(html)).toContain(m["zone.guessed.fix"]);
    expect(html).toContain('href="/dashboard/accounts/acct1/settings"');
  });

  it("offers a CLIENT a person to ask and no link at all (mutation: drop the `isAgency` branch -> FAILS)", () => {
    const html = render(FROM_AGENCY, false);
    expect(plain(html)).toContain(m["zone.guessed.client"]);
    expect(plain(html)).not.toContain(m["zone.guessed.fix"]);
    expect(html).not.toContain("/settings");
    expect(html).not.toContain("<a");
  });

  it("still names the zone for a client (mutation: render the label for the agency only -> FAILS)", () => {
    // The client is the reader most likely to be misled by an unlabelled
    // date — it is their own business's calls on screen.
    const html = render(FROM_FALLBACK, false);
    expect(plain(html)).toContain(m["zone.note"].replace("{zone}", "UTC"));
  });
});
