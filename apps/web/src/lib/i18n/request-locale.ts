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
  if (process.env.BIS_I18N_QA === "1") {
    const raw = searchParams?.locale;
    const override = Array.isArray(raw) ? raw[0] : raw;
    if (isLocale(override)) return override;
  }
  const { account, isOperator, userLanguage } = input;
  return isOperator
    ? resolveLocale(userLanguage, null)
    : resolveLocale(userLanguage, account?.language ?? null);
}
