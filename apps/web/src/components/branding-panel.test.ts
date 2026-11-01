import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderedText } from "@/lib/rendered-text";
import { m } from "@/lib/messages";
import { BrandingPanel } from "./branding-panel";

const here = path.dirname(fileURLToPath(import.meta.url));
const panelSource = readFileSync(path.join(here, "./branding-panel.tsx"), "utf8");

/**
 * The mailing-address field (migration 0048): a real render of the panel,
 * because what matters is the form the browser posts — the field's `name` is
 * the contract with setBrandingAction, and its place under the reply-to field
 * is the brief's.
 */
function render(
  mailingAddress: string | null,
  audience: "agency" | "client" = "client",
  locale: "en" | "es" = "en",
): string {
  return renderToStaticMarkup(createElement(BrandingPanel, {
    audience,
    brandName: "Rio Roofing",
    replyToEmail: "hello@rioroofing.com",
    mailingAddress,
    brandColor: null,
    brandNeutral: null,
    brandCorners: null,
    brandType: null,
    brandMode: null,
    logoUrl: null,
    action: async () => ({ ok: true as const }),
    locale,
  }));
}

function renderWithLogo(
  logoUrl: string | null,
  extra: Partial<{
    removeLogoAction: () => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
    restoreLogoAction: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  }> = {},
): string {
  return renderToStaticMarkup(createElement(BrandingPanel, {
    audience: "client",
    brandName: "Rio Roofing",
    replyToEmail: "hello@rioroofing.com",
    mailingAddress: null,
    brandColor: null,
    brandNeutral: null,
    brandCorners: null,
    brandType: null,
    brandMode: null,
    logoUrl,
    action: async () => ({ ok: true as const }),
    ...extra,
  }));
}

/** The one <textarea> the panel renders, whole. */
function textarea(html: string): string {
  const match = html.match(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/g) ?? [];
  expect(match, "exactly one textarea on the panel").toHaveLength(1);
  return match[0]!;
}

describe("BrandingPanel — mailing address", () => {
  it("renders a 3-row textarea the action reads as `mailingAddress`, labelled (mutation: rename the field → FAILS)", () => {
    const ta = textarea(render(null));
    expect(ta).toContain('name="mailingAddress"');
    expect(ta).toContain('id="mailing-address"');
    expect(ta).toContain('rows="3"');
    expect(render(null)).toMatch(
      new RegExp(`<label[^>]*for="mailing-address"[^>]*>${m["branding.mailingAddress"]}</label>`),
    );
  });

  it("is prefilled with the stored address, line breaks and all (mutation: drop defaultValue → FAILS)", () => {
    const ta = textarea(render("123 Main St\nMcAllen, TX 78501"));
    expect(ta).toMatch(/>\n?123 Main St\nMcAllen, TX 78501<\/textarea>$/);
  });

  it("is empty, not \"null\", when none is stored", () => {
    expect(textarea(render(null))).toMatch(/>\n?<\/textarea>$/);
  });

  it("sits directly under the reply-to field (mutation: move it below the colour → FAILS)", () => {
    const html = render(null);
    const replyTo = html.indexOf('id="reply-to-email"');
    const mailing = html.indexOf('id="mailing-address"');
    const color = html.indexOf('id="brand-color"');
    expect(replyTo).toBeGreaterThan(-1);
    expect(mailing).toBeGreaterThan(replyTo);
    expect(color).toBeGreaterThan(mailing);
  });

  it("carries the hint in the reader's own voice (mutation: hardcode the agency hint → FAILS on the client's page)", () => {
    expect(renderedText(render(null, "client"))).toContain(m["branding.clientMailingAddressHint"]);
    expect(renderedText(render(null, "agency"))).toContain(m["branding.mailingAddressHint"]);
  });
});

describe("BrandingPanel — Remove logo (DESIGN rule 6, rule 8)", () => {
  const ok = async () => ({ ok: true as const, path: "acct_1/logo.png" });
  const okUndo = async () => ({ ok: true as const });

  it("shows no Remove-logo button when there is no logo (mutation: render it unconditionally → FAILS)", () => {
    const html = renderWithLogo(null, { removeLogoAction: ok, restoreLogoAction: okUndo });
    expect(renderedText(html)).not.toContain(m["branding.removeLogo"]);
  });

  it("shows the Remove-logo button, as a ghost <button type='button'>, once a logo is set (mutation: drop type='button' → the browser would submit the Save form; mutation: drop variant='ghost' → FAILS)", () => {
    const html = renderWithLogo("https://cdn.example.com/acct_1/logo.png", {
      removeLogoAction: ok, restoreLogoAction: okUndo,
    });
    expect(renderedText(html)).toContain(m["branding.removeLogo"]);
    const match = html.match(/<button[^>]*>\s*Remove logo\s*<\/button>/);
    expect(match, "a <button> literally containing the Remove-logo label").not.toBeNull();
    expect(match![0]).toContain('type="button"');
    expect(match![0]).toContain('data-variant="ghost"');
    // The default variant's own class (button.tsx) — the card's Save button
    // already carries it, and rule 8 forbids a second primary in one view.
    expect(match![0]).not.toContain("btn-primary");
  });

  it("never renders the button at all without BOTH actions wired (mutation: show it with only removeLogoAction set → FAILS)", () => {
    const html = renderWithLogo("https://cdn.example.com/acct_1/logo.png", { removeLogoAction: ok });
    expect(renderedText(html)).not.toContain(m["branding.removeLogo"]);
  });

  // M4 (review, 2026-10-04): a double-click guard, the same `runGuarded`
  // pattern the Texts/Email rows share (lib/ui/guarded-run.ts, its own
  // test proves the guard logic itself) — this only pins that THIS button
  // actually goes through it rather than firing `runRemoveLogo` bare.
  it("runs the click through runGuarded's busy-ref guard, and disables the button while pending (mutation: call runRemoveLogo directly, or drop the disabled prop → FAILS)", () => {
    expect(panelSource).toContain('from "@/lib/ui/guarded-run"');
    expect(panelSource).toMatch(/runGuarded\(removeBusy, startRemoveTransition,/);
    expect(panelSource).toMatch(/<Button type="button" variant="ghost" size="sm" onClick=\{removeLogo\} disabled=\{removePending\}>/);
  });

  // Review fix round (S-10 T6, I-1): runRemoveLogo's own toasts
  // ("Logo removed", "Undo", the crashed sentence) read m[...] directly —
  // English regardless of the reader's own locale, because the panel never
  // passed one through. Same for SubmitButton's "Saving..." text.
  it("passes the panel's own locale into runRemoveLogo and into SubmitButton (mutation: call either with no locale → FAILS)", () => {
    expect(panelSource).toMatch(/runRemoveLogo\(removeLogoAction, restoreLogoAction, setHasLogo, toast, locale\)/);
    expect(panelSource).toContain("<SubmitButton pending={pending} locale={locale}>");
  });
});

// D-071 review round: the colour-only/unset preview's "Sidebar" specimen
// painted its own background from SIDEBAR_BG (the CONTRAST TARGET, after the
// split — not a colour meant to be looked at) and its label text from a
// hard-coded "#d4d4d8", the pre-Northern-Lights --sidebar-text literal
// (DESIGN.md's Installation status log: it moved to #a9a3bd, then to
// today's #b9b3cf). Neither is a token-or-constant literal island this
// file is allowed to keep.
describe("BrandingPanel — the unset/colour-only preview's sidebar specimen (D-071)", () => {
  it("paints its background from SIDEBAR_PREVIEW_BG, never SIDEBAR_BG (mutation: swap back to SIDEBAR_BG → still passes today by value, so this also pins the import) and its label from SIDEBAR_FOREGROUND, never the stale #d4d4d8", () => {
    expect(panelSource).toContain('from "@/lib/branding/color"');
    expect(panelSource).toMatch(/import\s*\{[^}]*SIDEBAR_PREVIEW_BG[^}]*\}\s*from\s*"@\/lib\/branding\/color"/);
    expect(panelSource).not.toMatch(/\bSIDEBAR_BG\b/);
    expect(panelSource).toContain('from "@/lib/branding/neutral-ramps"');
    expect(panelSource).not.toContain("#d4d4d8");
    expect(panelSource).toContain("backgroundColor: SIDEBAR_PREVIEW_BG");
    expect(panelSource).toContain("color: SIDEBAR_FOREGROUND");
  });

  it("renders the specimen with the real token values when no theme is set (brandColor null)", () => {
    const html = render(null);
    expect(html).toContain('style="background-color:#100f17"');
    expect(html).toMatch(/style="color:#b9b3cf"[^<]*>Sidebar</);
  });
});

// S-10 T6: every field label, hint, button and preview string read m[...]
// directly — English regardless of the reader's own stored choice. The
// panel now takes an optional `locale` prop (default "en", so Settings'
// own render, which never passes one, is unaffected) and reads every
// string through t()/panelCopy(audience, locale).
describe("BrandingPanel — Spanish (S-10 T6)", () => {
  it("every field label, the hints, the logo field and Save read in Spanish on the client's own page (mutation: hard-code m[key] → FAILS)", () => {
    const text = renderedText(render(null, "client", "es"));
    const all = m as Record<string, string>;
    for (const key of [
      "branding.name", "branding.logo", "branding.logoHint", "branding.replyTo", "branding.mailingAddress",
      "branding.color", "branding.noLogo", "common.save",
    ]) expect(text, key).toContain(all[`${key}.es`]);
    expect(text).toContain(m["branding.clientNameHint.es"]);
    expect(text).toContain(m["branding.clientColorHint.es"]);
    expect(text).toContain(m["branding.clientReplyToHint.es"]);
    expect(text).toContain(m["branding.clientMailingAddressHint.es"]);
    expect(text).not.toContain(m["branding.name"]);
  });

  it("the radio groups (Surfaces, Corners, Typeface, Default appearance) and their options read in Spanish (mutation: leave RadioRow legends/options in English → FAILS)", () => {
    const text = renderedText(render(null, "client", "es"));
    const all = m as Record<string, string>;
    for (const key of [
      "branding.neutral", "branding.themeDefault", "branding.neutralWarm", "branding.neutralCool", "branding.neutralSlate",
      "branding.corners", "branding.cornersSharp", "branding.cornersSoft", "branding.cornersRound",
      "branding.type", "branding.typeGeist", "branding.typeInter", "branding.typeSerif",
      "branding.mode", "branding.modeLight", "branding.modeDark", "branding.clientModeFollow",
    ]) expect(text, key).toContain(all[`${key}.es`]);
  });

  it("the colour-only preview's Submit and Sidebar labels read in Spanish (mutation: skip the preview block → FAILS)", () => {
    const text = renderedText(render(null, "client", "es"));
    expect(text).toContain(m["branding.previewSubmit.es"]);
    expect(text).toContain(m["branding.previewSidebar.es"]);
  });

  it("the Current logo state and Remove logo read in Spanish (mutation: hard-code m[key] in the logo block → FAILS)", () => {
    const html = renderToStaticMarkup(createElement(BrandingPanel, {
      audience: "client", brandName: "Rio Roofing", replyToEmail: null, mailingAddress: null,
      brandColor: null, brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
      logoUrl: "https://cdn.example/logo.png", action: async () => ({ ok: true as const }),
      removeLogoAction: async () => ({ ok: true as const, path: "a/logo-x.png" }),
      restoreLogoAction: async () => ({ ok: true as const }),
      locale: "es",
    }));
    const text = renderedText(html);
    expect(text).toContain(m["branding.currentLogo.es"]);
    expect(text).toContain(m["branding.removeLogo.es"]);
  });

  it("the agency's own Settings render is unaffected (no locale passed, defaults to English) (mutation: default the prop to es → FAILS)", () => {
    const text = renderedText(render(null, "agency"));
    expect(text).toContain(m["branding.title"]);
    expect(text).toContain(m["branding.nameHint"]);
  });
});

// m6 (review fix round): the toast-pseudo policy is "never" everywhere —
// a toast is post-interaction feedback, not the page's own static render,
// so it is never wired through `tr.text()` (which pseudo-pads), only plain
// `t(m, key, locale)`. The SAME policy alert-phone-card.tsx and
// team-copy.ts's `teamErrorCopy` both carry (each with its own comment
// making the same call), so this file's own toasts can never drift from
// theirs.
describe("BrandingPanel — toasts never read through tr.text() (m6, review fix round)", () => {
  it("no toast.error/toast.success call reads tr.text() (mutation: toast.error(tr.text(\"branding.tooLarge\")) → FAILS)", () => {
    expect(panelSource).not.toMatch(/toast\.(error|success)\([^)]*tr\.text\(/);
  });
  it("the three toast strings this form uses are all plain t(m, key, locale) calls", () => {
    for (const key of ["branding.tooLarge", "branding.saved", "common.actionCrashed"]) {
      expect(panelSource).toContain(`t(m, "${key}", locale)`);
    }
  });
});
