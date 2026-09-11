import type { ComponentProps } from "react";
import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth-shell";
import { m } from "@/lib/messages";

/**
 * Clerk restyled through OUR values, but as STYLE OBJECTS, not class names.
 *
 * `elements` accepts `string | CSSObject` per @clerk/react's own types.
 * Class names looked like they worked — Clerk applies them to the element
 * alongside its own — but measuring the actual computed style, element by
 * element, showed classes win only for properties Clerk's own base styles
 * leave unset: `card` still rendered Clerk's own background, shadow and
 * 32px padding (the fifth-surface DESIGN.md rule 2 forbids, live in
 * production), both control radii stayed Clerk's 6px over our 8px
 * `--radius-ctl`, and more. Clerk's runtime CSS-in-JS emits its structural
 * `.cl-internal-*` rules UNLAYERED, and unlayered author CSS beats layered
 * author CSS — the whole Tailwind utility layer stack included — at any
 * specificity, so a class can never win here. A style object sidesteps the
 * layer question entirely: Clerk merges the object we pass into the SAME
 * generated rule as its own defaults for that element (confirmed by reading
 * the merged rule text off a live node), with our declarations appended
 * after Clerk's. There is no cascade boundary being crossed — it is the
 * ordinary CSS rule that, within one rule, the later declaration for a given
 * property wins, so ours simply becomes the value while any property we did
 * not set passes through as Clerk's own. `var()` inside a style object
 * resolves exactly as it does in a stylesheet, so every colour, radius and
 * shadow below still comes from tokens.css (DESIGN.md: components consume
 * tokens only) and still follows the existing `.dark` class with no Clerk
 * theme swap and no flash — only the delivery mechanism changed, not where
 * the values come from.
 *
 * `variables` is deliberately unused. `{ colorPrimary: 'var(--accent)' }` would
 * typecheck — CssColor is a bare `string` — but Clerk derives a whole shade
 * scale from that value at runtime, which needs a colour it can parse. It
 * compiles and may simply not work, which is the worst of both.
 *
 * `cssLayerName` still matters for what it actually covers: Clerk's
 * THEMEABLE styles (driven by `variables`/`theme`) do land in the `clerk`
 * layer, declared first in globals.css and weaker than every Tailwind
 * utility. It does not cover Clerk's structural CSS-in-JS output — that's
 * the unlayered rule set above, and no layer name changes that.
 *
 * `satisfies` checks the TOP-LEVEL keys (`cssLayerName`, `options`,
 * `elements`) and catches a wrong one there. It does NOT check the keys
 * inside `elements`: Clerk types that as a union of ~150 single-key
 * records, and TypeScript's excess-property checking does not fire against
 * a union that large — verified by compiling a misspelled key against the
 * real types and getting no error. A wrong element key is therefore
 * silent, and the computed-style probes in signed-out.spec.ts are the only
 * thing that catches one: a style that never applies shows up as Clerk's
 * own value.
 */
const appearance = {
  cssLayerName: "clerk",
  // `options`, not `layout`: Clerk's public docs still describe this bucket as
  // `layout`, but @clerk/react@6.12.8's actual Theme type (Options, in the
  // same types-*.d.mts as GlobalAppearanceOptions above) names it `options`.
  // `logoPlacement` lives in the same place either way — this is a key rename
  // between doc generations, not a semantic change.
  options: {
    // Our mark is in the rail. Clerk must not draw a second one.
    logoPlacement: "none",
  },
  elements: {
    // A STYLE OBJECT, not the `hidden` class — and that difference is the
    // whole finding of this task. `elements` takes `string | CSSObject`, and
    // the class route does not work here: Clerk's runtime CSS-in-JS emits its
    // structural `.cl-internal-*` rules UNLAYERED, and unlayered author CSS
    // beats layered author CSS at any specificity, so Tailwind's `.hidden`
    // (in `@layer utilities`) loses to Clerk's `display: flex` no matter how
    // the layers are ordered. `cssLayerName` governs Clerk's themeable styles,
    // not its structural ones. Confirmed at runtime by walking
    // document.styleSheets for CSSLayerBlockRule.
    //
    // The fix is Clerk's own API rather than out-specifying it: Clerk merges
    // the object we pass into the SAME generated rule as its own defaults,
    // our declarations appended after Clerk's — ordinary last-declaration-
    // wins within one rule, not a cascade fight. `!important` would have
    // "worked" and taught us nothing.
    header: { display: "none" },
    // EVERY entry below is a style object for the same reason, and this was
    // MEASURED element by element rather than assumed. With class names, only
    // properties Clerk leaves unset came through: `card` kept Clerk's
    // background, shadow and 32px padding — so the card-inside-a-card
    // DESIGN.md rule 2 forbids was actually rendering — both controls kept
    // Clerk's 6px radius over our 8px token, and `main` kept Clerk's 24px gap.
    //
    // Tokens still hold: `var()` inside a style object resolves against the
    // element exactly as it does in a stylesheet. The sizes written as px are
    // Tailwind scale values (h-9 = 36px, text-sm = 14px), not design tokens —
    // the rule names colour, radius and shadow, and every one of those is a
    // var() here.
    rootBox: { width: "100%" },
    // The shell already IS the card. Flattened rather than restyled: a card
    // inside a card is a fifth surface by another name (DESIGN.md rule 2).
    cardBox: { width: "100%", boxShadow: "none", border: "0", background: "transparent" },
    card: {
      width: "100%",
      boxShadow: "none",
      border: "0",
      background: "transparent",
      padding: "0",
      gap: "12px",
    },
    main: { gap: "12px" },
    footer: { background: "transparent" },
    socialButtonsBlockButton: {
      height: "36px",
      borderRadius: "var(--radius-ctl)",
      border: "1px solid var(--line-strong)",
      background: "transparent",
      fontSize: "14px",
      fontWeight: "500",
      color: "var(--text-1)",
    },
    dividerLine: { background: "var(--line)" },
    dividerText: {
      fontFamily: "var(--font-mono)",
      fontSize: "10px",
      textTransform: "uppercase",
      letterSpacing: "0.14em",
      color: "var(--text-2)",
    },
    formFieldLabel: { fontSize: "12px", fontWeight: "500", color: "var(--text-2)" },
    formFieldInput: {
      height: "36px",
      borderRadius: "var(--radius-ctl)",
      border: "1px solid var(--input-line)",
      background: "var(--input-bg)",
      fontSize: "14px",
      color: "var(--text-1)",
    },
    formButtonPrimary: {
      height: "36px",
      borderRadius: "var(--radius-ctl)",
      // What `btn-primary` sets, inlined — the utility class itself won here,
      // but mixing one class among eleven style objects hides which mechanism
      // is load-bearing on which element.
      backgroundImage: "var(--gradient-primary)",
      boxShadow: "var(--shadow-glow)",
      fontSize: "14px",
      fontWeight: "600",
      textTransform: "none",
    },
  },
  // The intersection, not a bare `ComponentProps<typeof SignIn>["appearance"]`:
  // @clerk/react@6.12.8's own types augment the global ClerkAppearanceRegistry
  // with `theme: Theme` (dist/index.d.mts) rather than `Theme & GlobalAppearanceOptions`,
  // so `cssLayerName` — real, documented on GlobalAppearanceOptions in the same
  // package's types-*.d.mts, and the one property this whole file exists to set —
  // does not type-check against that narrowed alias. This intersection adds back
  // only the missing field; every TOP-LEVEL key (`cssLayerName`, `options`,
  // `elements` itself) still excess-property-checks against Clerk's real Theme
  // type, so a mistyped TOP-LEVEL key still fails here. It does NOT reach inside
  // `elements`: Clerk types that as a union of ~150 single-key records, a known
  // TypeScript blind spot for excess-property checking against a union that
  // large — verified by compiling a misspelled element key (`haeder`) against
  // the real types on both this widened target and the original narrow one,
  // and getting no error either way. A wrong element key is therefore silent;
  // the computed-style probes in signed-out.spec.ts are what catches one.
} satisfies NonNullable<ComponentProps<typeof SignIn>["appearance"]> & { cssLayerName?: string };

export default function Page() {
  return (
    // This route is a catch-all: it also renders Clerk's TASK screens, such as
    // /sign-in/tasks/choose-organization, which is a different component of
    // theirs inside the same shell. Nothing here may fix a height or assume
    // the sign-in card's contents — and Clerk can inject a Smart CAPTCHA
    // mid-flow, so the card has to be free to grow.
    <AuthShell>
      <h1 className="font-display text-2xl font-[650] tracking-[-0.02em] text-foreground">
        {m["signIn.title"]}
      </h1>
      <SignIn appearance={appearance} />
    </AuthShell>
  );
}
