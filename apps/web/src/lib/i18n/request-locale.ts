// The one call site every account-scoped server component/action uses to
// resolve its render locale. `account` is whatever the caller already
// loaded for branding/timezone — this reads one more field off that same
// row, never a second query (same discipline as zone.ts's own doc comment
// on readAgencyZone()'s eager-evaluation trap).
//
// Owner decision 1 (2026-10-10, plan-review C2): account.language governs
// CLIENT-role sessions only. An agency operator who opens a Spanish-
// language client's account does NOT get a Spanish dashboard from that
// alone — their own session stays English until the parallel staff-and-
// roles lane's `users.language` exists. This is the SAME role split
// `resolveThemeMode`'s own `isOperator` parameter already draws for
// dark/light (`branding/theme-mode.ts`), sourced the same way
// `getRequestTheme`'s `getIsOperator()` sources it for theme — callers here
// pass `requireAccountAccess`'s own `isAgency` (`lib/auth.ts`) straight
// through as `isOperator`.
import { resolveLocale, type Locale } from "./locale";

function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "es";
}

/** The QA override (`?locale=`, `?locale=pseudo`) is on only when BOTH hold:
 *  the explicit flag (set only in Playwright's webServer env and CI's e2e
 *  job), AND this is not a Vercel deployment — Vercel sets `VERCEL` on every
 *  deployment it builds or runs, so a flag that strayed into a deployment's
 *  env still cannot switch anything there (M2, whole-branch review). A plain
 *  string comparison and a presence read; no value is parsed (Global
 *  Constraints: no .env value parsed by code that can throw). */
function qaOverrideEnabled(): boolean {
  return process.env.BIS_I18N_QA === "1" && !process.env.VERCEL;
}

export function requestLocale(
  input: {
    account: { language: Locale | null } | null | undefined;
    isOperator: boolean;
    /** Not yet populated by any caller in this lane — the seam for the
     *  parallel staff-and-roles lane's `users.language`. Threaded into
     *  `resolveLocale` on BOTH branches, so an operator's own stored
     *  language (once it exists) still wins over staying in English. */
    userLanguage?: Locale | null;
  },
  searchParams?: Record<string, string | string[] | undefined>,
): Locale {
  // Plan-review I4: gated on an EXPLICIT flag, never NODE_ENV. The e2e
  // suite runs this override against `next build` + `next start`, where
  // NODE_ENV is "production" — gating on NODE_ENV would make the override
  // dead in exactly the place Task 11 needs it. Plain string comparison,
  // no parsing (Global Constraints: no .env value parsed by code that can
  // throw). Set ONLY in Playwright's webServer env (Task 11) and CI's e2e
  // job — NEVER on a Vercel deployment (orchestrator checklist, below).
  if (qaOverrideEnabled()) {
    const raw = searchParams?.locale;
    const override = Array.isArray(raw) ? raw[0] : raw;
    if (isLocale(override)) return override;
  }
  const { account, isOperator, userLanguage } = input;
  return isOperator
    ? resolveLocale(userLanguage, null)
    : resolveLocale(userLanguage, account?.language ?? null);
}

// Task 11 (Spanish-runtime lane): gates the pseudo-locale overflow check,
// additive to `requestLocale` above — same flag, same plain-string
// comparison discipline (no .env value parsed by code that can throw).
// Deliberately NOT a third member of the `Locale` type: pseudo-locale is a
// rendering transform applied to the ENGLISH string AFTER t()/
// formatCurrency resolve it (pseudo-locale.ts's `pseudoLocale()`), never a
// real catalogue locale `resolveLocale` could return — keeping `Locale`
// itself at exactly "en" | "es" means nothing upstream needs to change for
// this to exist. Both conditions are required: the flag alone (set in
// Playwright's webServer env and CI's e2e job — never on a Vercel
// deployment) would otherwise force EVERY page into pseudo mode rather
// than only the ones a test explicitly opts into via `?locale=pseudo`.
export function requestPseudoMode(
  searchParams?: Record<string, string | string[] | undefined>,
): boolean {
  if (!qaOverrideEnabled()) return false;
  const raw = searchParams?.locale;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "pseudo";
}
