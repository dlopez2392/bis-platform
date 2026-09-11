import type { ComponentProps } from "react";
import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth-shell";
import { m } from "@/lib/messages";

/**
 * Clerk restyled through OUR class names, not through `appearance.variables`.
 *
 * `elements` accepts `string | CSSObject` per @clerk/react's own types, so a
 * class name is a first-class value here — which keeps every colour in
 * tokens.css (DESIGN.md: components consume tokens only) and makes light/dark
 * follow the existing `.dark` class with no Clerk theme swap and no flash.
 *
 * `variables` is deliberately unused. `{ colorPrimary: 'var(--accent)' }` would
 * typecheck — CssColor is a bare `string` — but Clerk derives a whole shade
 * scale from that value at runtime, which needs a colour it can parse. It
 * compiles and may simply not work, which is the worst of both.
 *
 * `cssLayerName` is what makes any of this apply: it puts Clerk's stylesheet in
 * the `clerk` layer, declared first in globals.css and therefore weaker than
 * every Tailwind utility. Without it these classes lose and nothing says so.
 *
 * `satisfies` rather than a plain const: it keeps excess-property checking on
 * the object literal, so a mistyped element key is a typecheck error instead of
 * a line that silently styles nothing.
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
    // The fix is Clerk's own API rather than out-specifying it: a style object
    // is applied by Clerk to that element directly, so it lands on the same
    // side of the cascade as the rule it needs to beat. `!important` would
    // have "worked" and taught us nothing.
    header: { display: "none" },
    // The shell already IS the card. Flattened rather than restyled: a card
    // inside a card is a fifth surface by another name (DESIGN.md rule 2).
    rootBox: "w-full",
    cardBox: "w-full shadow-none border-0 bg-transparent",
    card: "w-full shadow-none border-0 bg-transparent p-0 gap-3",
    main: "gap-3",
    footer: "bg-transparent",
    socialButtonsBlockButton:
      "h-9 rounded-[var(--radius-ctl)] border border-[var(--line-strong)] bg-transparent text-sm font-medium text-foreground",
    dividerLine: "bg-border",
    dividerText: "font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground",
    formFieldLabel: "text-xs font-medium text-muted-foreground",
    formFieldInput:
      "h-9 rounded-[var(--radius-ctl)] border border-[var(--input-line)] bg-[var(--input-bg)] text-sm text-foreground",
    formButtonPrimary:
      "btn-primary h-9 rounded-[var(--radius-ctl)] text-sm font-semibold normal-case",
  },
  // The intersection, not a bare `ComponentProps<typeof SignIn>["appearance"]`:
  // @clerk/react@6.12.8's own types augment the global ClerkAppearanceRegistry
  // with `theme: Theme` (dist/index.d.mts) rather than `Theme & GlobalAppearanceOptions`,
  // so `cssLayerName` — real, documented on GlobalAppearanceOptions in the same
  // package's types-*.d.mts, and the one property this whole file exists to set —
  // does not type-check against that narrowed alias. This intersection adds back
  // only the missing field; every other key (layout, elements, and each element's
  // sub-keys) still excess-property-checks against Clerk's real Theme type, so a
  // mistyped element key still fails here exactly as intended.
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
