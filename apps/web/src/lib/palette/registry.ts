import { SURFACE_MANIFEST, audienceIncludes, type SurfaceScope } from "@/lib/surfaces/manifest";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
// The SUBPATH, not "@bis/db": that barrel pulls in @supabase/supabase-js, and
// this registry is imported by a client component (command-palette.tsx).
// nameFold is the same accent fold search-highlight.ts already uses for
// contact search (F-095 part 1) — reused, not reinvented.
import { nameFold } from "@bis/db/dedupe-keys";

export type PaletteGroup = "navigation" | "settings" | "actions";

/** Actions are NAVIGATION-SAFE only (DESIGN.md rule 6 governs destructive
 *  work on its own surfaces). Nothing that writes tenant data belongs here:
 *  a fuzzy match is one keystroke from Enter. */
export type PaletteActionId = "toggle-theme";

export type PaletteEntry = {
  id: string;
  label: string;
  group: PaletteGroup;
  /** Belt-and-braces only. `buildPaletteEntries` never EMITS an agency-only
   *  entry for a client — this flag exists so a test can assert that, and so a
   *  future consumer cannot re-add one by accident. Hiding an entry is not
   *  authorization; every route still guards itself. */
  agencyOnly: boolean;
  /** Words an operator might type that the label does not contain. */
  keywords: string[];
  /** F-095 part 1 (spec §4.4): the catalogue key `label` was rendered from,
   *  threaded alongside the rendered string so a test can look up the OTHER
   *  language's twin independently of whichever locale built this entry.
   *  Additive-optional (owner ruling 2) — set at every `entries.push` call
   *  site below that already computes `label(key)`, never a second source of
   *  truth for the rendered text itself. */
  labelKey?: MessageKey;
} & (
  | { kind: "href"; href: string }
  | { kind: "action"; actionId: PaletteActionId }
);

/**
 * Extra search words per manifest entry, keyed by the manifest's OWN stable
 * `id` (surfaces/manifest.ts), never by href suffix or settings anchor
 * (F-087 part 1, owner ruling Q3: "keywords stay a separate, palette-only
 * lookup keyed by manifest id" — a search-ranking concern the palette owns,
 * not "what surfaces exist"). An entry with no row here simply has none.
 * This replaces both `NAV_KEYWORDS` (href-suffix-keyed) and
 * `SETTINGS_SECTIONS`'s own per-anchor arrays, which the manifest itself
 * now carries (anchor, labelKey, route) — only the keyword WORDS stayed
 * behind, re-keyed.
 */
// Exported only so a test can assert every key here is still a real
// manifest id (F-087 fix round, Minor 4) — nothing in this module reads it
// via the export, which continues to use the module-local binding below.
export const ENTRY_KEYWORDS: Record<string, string[]> = {
  // F-095 part 1 (spec §4.2): "inicio" also means "sign-in" per the glossary's
  // own exclusion note — kept anyway since it is still the right word for
  // THIS destination; the exclusion only bans it as a stand-in elsewhere.
  "nav:dashboard": ["home", "overview", "inicio", "panel"],
  // F-087 part 1 (owner ruling Q2): the agency's own top-level /dashboard —
  // the same "home"-ish words as the in-account Dashboard above.
  "nav:/dashboard": ["home", "overview", "inicio", "panel"],
  "nav:contacts": ["people", "customers", "leads", "contactos", "clientes", "prospectos"],
  // S-07 3a (spec 3.1): the document vault's account-wide list.
  "nav:documents": ["files", "vault", "expiring", "expired", "expiry", "insurance", "permit", "license", "warranty", "documentos", "archivos", "vencen", "vencidos"],
  "nav:pipeline": ["deals", "opportunities", "sales", "oportunidades", "embudo"],
  "nav:conversations": ["messages", "inbox", "sms", "email", "conversaciones", "mensajes", "bandeja"],
  "nav:calls": ["phone", "receptionist", "sofia", "llamadas", "teléfono"],
  // "activity" added 2026-09-21 (cleanup item 2): the nav label changed to
  // "What went out" to stop colliding with the dashboard's own Activity
  // card, but the old word should still find this page.
  "nav:activity": ["history", "activity", "what went out", "sent", "waiting", "held", "skipped", "quiet hours", "usage", "log"],
  "nav:forms": ["lead form", "intake", "formularios"],
  // "closed days"/"holiday"/"vacation"/"días cerrados"/"feriado"/"vacaciones" added S-47d (spec 5.6.3):
  // the Closed days card.
  // "phone calendar"/"subscribe"/"ical"/"ics"/"iphone"/"google calendar"/"outlook"/"calendario del teléfono"/
  // "suscribirse" added F-048 part 2: the Bookings on your phone card.
  "nav:calendar": ["booking", "availability", "hours", "closed days", "holiday", "vacation", "días cerrados", "feriado", "vacaciones",
    "phone calendar", "subscribe", "ical", "ics", "iphone", "google calendar", "outlook", "calendario del teléfono", "suscribirse",
    // F-046 part 1: the agenda card.
    "agenda", "schedule", "add job", "trabajo", "agregar trabajo",
    // F-095 part 1 (spec §4.2): "cita" is the glossary's word for
    // appointment/booking — the brief's own worked example.
    "citas", "horario", "disponibilidad"],
  "nav:tasks": ["task", "tasks", "to-do", "todo"],
  "nav:branding": ["logo", "colors", "theme", "marca", "logotipo", "colores"],
  // "hours"/"prices"/"services"/"horario"/"precios" added S-47c (spec 5.7): the Business hours and
  // Services & prices cards.
  "nav:voice": ["receptionist", "sofia", "ai", "website", "widget", "chat", "concierge", "bubble", "transfer", "forward", "person", "phones", "hours", "prices", "services", "horario", "precios"],
  "nav:automations": ["no-show", "no show", "text reminder", "reminder", "reviews", "review requests", "google review", "follow up", "text", "referral", "reactivation", "quote", "confirmation", "instant reply"],
  "nav:accounts": ["companies", "clients"],
  "nav:blueprints": ["templates"],
  "nav:numbers": ["phone", "telnyx", "did", "line", "inventory", "reassign"],
  "nav:screened": ["refused", "blocked", "spam", "declined", "rejected", "turned away"],
  "nav:plans": ["billing", "pricing", "stripe", "subscription", "tier", "allowance", "overage"],
  "nav:billing": ["invoice", "invoices", "card", "payment", "plan", "subscription", "receipt"],
  // Staff and roles (Task 8): "equipo" (F-095 part 1) — nav.team's own
  // Spanish label, the word itself was missing before so an English-locale
  // session could not find this entry by it.
  "nav:team": ["team", "staff", "people", "invite", "users", "logins", "employees", "equipo"],
  "settings:team": ["team", "staff", "invite", "logins", "people", "equipo"],
  "nav:required-documents": ["documents", "checklist", "required", "missing", "documentos", "requeridos"],
  "nav:bis-access": ["bis", "access", "log", "visits", "who looked", "acceso", "registro", "visitas"],
  // "ajustes" (F-095 part 1): nav.settings' own Spanish label. Never
  // "configuración"/"configuracion" here — the glossary bans that word for
  // Settings (i18n/spanish-style.ts's G6 "settings" rule); those two
  // keywords belong to nav:setup below (spec §0/§7's corrected mapping).
  "nav:settings": ["configuration", "preferences", "ajustes"],
  // "configuración"/"configuracion" (F-095 part 1, spec §0/§7): the
  // brief's own worked example, corrected against the shipped glossary —
  // "Configuración" is nav.setup's Spanish label (not Settings').
  "nav:setup": ["wizard", "activation", "onboarding", "go live", "configuración", "configuracion"],
  "nav:preferences": ["preferences", "language", "idioma", "español", "spanish", "english", "theme", "dark", "light", "appearance", "my"],
  // F-095 part 1 (spec §4.2): "acceso"/"invitación" added — "portal" is
  // already shared between the two languages, so it is not repeated.
  "settings:client-access": ["login", "invite", "portal", "acceso", "invitación"],
  "settings:sending-address": ["email", "from", "domain", "never record", "block", "ignore sender", "correo", "dominio", "remitente"],
  // "crm" is already shared between the two languages.
  "settings:custom-fields": ["field", "crm", "campo"],
  // "variable" is already shared between the two languages.
  "settings:custom-values": ["value", "variable", "merge", "valor"],
  "settings:alert-phone": ["sms", "text", "notify", "lead alert", "texto", "alerta", "aviso"],
  // "plan" is already shared between the two languages.
  "settings:billing": ["plan", "subscription", "invoice", "stripe", "complimentary", "payment", "suscripción", "factura", "pago"],
  // D-080: three real cards on this same page (settings/page.tsx's
  // <BrandingPanel>, <WeeklyReportCard id="weekly-report">, <LinkSiteCard
  // id="website">) had no entry here at all.
  "settings:branding": ["logo", "colors", "theme", "brand name", "logotipo", "colores", "marca"],
  "settings:weekly-report": ["email report", "monday", "recipients", "reporte", "lunes", "destinatarios"],
  "settings:website": ["analytics", "traffic", "vercel", "domain", "link site", "tráfico", "análisis", "dominio"],
  // S-07 2c: the required-documents list (settings/required-documents-card.tsx)
  "settings:required-documents": ["documents", "checklist", "required", "missing", "vault", "documentos", "requeridos"],
  // Item 8a-1: the agency's AI card (settings/ai-card.tsx, #ai).
  "settings:ai": ["ai", "budget", "spend", "switch", "summaries", "suggestions", "ia", "presupuesto"],
  // S-53: the company's trade (settings/trade-card.tsx, #trade).
  "settings:trade": ["trade", "industry", "business type", "vetting", "giro", "restaurant", "sofia", "web chat"],
};

/** Whether `entry.scope` applies to this call's own `base` — the same three
 *  scopes `buildNavGroups` reasons about (surfaces/manifest.ts), plus
 *  "person" (offered with or without an account in scope). */
function scopeApplies(scope: SurfaceScope, base: string | null): boolean {
  if (scope === "person") return true;
  if (scope === "agency-top") return base === null;
  return base !== null;
}

/**
 * Every palette destination and action for this caller.
 *
 * F-087 part 1: iterates `SURFACE_MANIFEST` once (surfaces/manifest.ts) —
 * the same one typed map `buildNavGroups` reads — rather than deriving from
 * `buildNavGroups`'s own output and re-pushing six more hand-written extras
 * (`SETTINGS_SECTIONS` and the nav:team/settings:team/nav:required-documents/
 * nav:bis-access/nav:settings/nav:setup pushes this used to carry). A nav
 * destination still cannot exist without a palette entry — both functions
 * filter the SAME manifest by the SAME three audience flags — and
 * `registry.test.ts`'s own parity test still asserts it, unedited.
 *
 * `base` is the in-account prefix (`/dashboard/accounts/<id>`), or null at the
 * agency top level where there is no account in scope.
 */
export function buildPaletteEntries(
  base: string | null, isAgency: boolean, isOwner: boolean, isTechnician = false, locale: Locale = "en",
): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  // S-10 + F-095 part 1: the label is in the reader's language, and the
  // OTHER language's own label always joins the keywords — symmetric now
  // (the one-way `locale === "en"` branch this used to have let a Spanish
  // reader find an English word but never the reverse; registry.test.ts's
  // completeness check, §4.4, pins the fix in both directions).
  const label = (key: MessageKey) => t(m, key, locale);
  const otherLocale: Locale = locale === "en" ? "es" : "en";
  const words = (key: MessageKey, keywords: string[]) =>
    [...keywords, t(m, key, otherLocale).toLowerCase()];

  for (const entry of SURFACE_MANIFEST) {
    if (!scopeApplies(entry.scope, base)) continue;
    // A Technician (F-085 part 1, spec §9): the manifest's own
    // `audience.technician` flag leaves out every route they cannot enter,
    // same filter `buildNavGroups` applies.
    if (!audienceIncludes(entry.audience, isAgency, isOwner, isTechnician)) continue;
    const href = entry.route(base);
    // A nav-rendered entry (carries `iconKey`, so `buildNavGroups` also
    // renders it) keeps the base-baked `nav:${href}` id every existing
    // test already pins. Every other entry — a settings-section anchor, or
    // one of the standalone extras (Team, Required documents, BIS access,
    // Settings, Setup, Preferences, and now the agency's own top-level
    // /dashboard) — carries its own fixed, base-independent manifest id as
    // the exposed one, exactly as each used to be hand-pushed.
    const id = entry.iconKey ? `nav:${href}` : entry.id;
    entries.push({
      kind: "href",
      id,
      label: label(entry.labelKey),
      group: entry.kind === "settings-section" ? "settings" : "navigation",
      // Belt-and-braces only (see PaletteEntry's own doc comment): true for
      // exactly the set a nav-rendered item never is (buildNavGroups
      // already withheld those for a client) — a non-nav entry whose
      // audience is agency, and ONLY agency. Matches today's observed
      // values (nav:settings, nav:setup, settings:team, every
      // settings-section anchor) without re-deriving them by hand.
      agencyOnly: !entry.iconKey && entry.audience.agency && entry.audience.client === false && !entry.audience.technician,
      keywords: words(entry.labelKey, ENTRY_KEYWORDS[entry.id] ?? []),
      labelKey: entry.labelKey,
      href,
    });
  }

  entries.push({
    kind: "action",
    id: "action:toggle-theme",
    label: label("palette.action.toggleTheme"),
    group: "actions",
    agencyOnly: false,
    // "oscuro"/"claro"/"apariencia"/"tema" (F-095 part 1, spec §4.2): words
    // of palette.action.toggleTheme's own Spanish label ("Cambiar entre
    // modo claro y oscuro").
    keywords: ["dark", "light", "appearance", "theme", "oscuro", "claro", "apariencia", "tema"],
    labelKey: "palette.action.toggleTheme",
    actionId: "toggle-theme",
  });

  return entries;
}

/**
 * F-095 part 1 (spec §4.1): the same accent fold `search-highlight.ts`
 * already uses for contact search, reused unchanged rather than
 * reimplemented — `nameFold` lower-cases AND strips the 24 upper/lower
 * accented Spanish/Portuguese letters (dedupe-keys.ts), so "configuracion"
 * (typed, no accent) matches a haystack holding "configuración" (stored,
 * with the accent) and the reverse. Display is never folded — this helper
 * is used ONLY inside matching, never on `entry.label` where it is rendered
 * (command-palette.tsx reads `entry.label` directly).
 */
function foldWords(text: string): string {
  return nameFold(text);
}

type Tier = 0 | 1 | 2; // lower ranks first

/**
 * F-095 part 1 (spec §4.3): a label match outranks a keyword-only match, so
 * folding (which makes more entries match a short query than before) does
 * not bury the obvious destination under one whose keyword merely happens
 * to contain the same substring. Tier 0 (every term starts the folded
 * label) and tier 1 (every term is somewhere in the folded label) only
 * differ for a multi-term query; a single-term query that matches the
 * label's own first word reaches tier 0, every other label match reaches
 * tier 1, and a keyword-only match reaches tier 2. Returns null when the
 * query does not match at all, so `filterEntries` can drop the entry.
 */
function matchTier(entry: PaletteEntry, terms: string[]): Tier | null {
  const foldedLabel = foldWords(entry.label);
  const foldedKeywords = foldWords(entry.keywords.join(" "));
  const haystack = `${foldedLabel} ${foldedKeywords}`;
  if (!terms.every((term) => haystack.includes(term))) return null;
  if (terms.every((term) => foldedLabel.startsWith(term))) return 0;
  if (terms.every((term) => foldedLabel.includes(term))) return 1;
  return 2;
}

/**
 * Accent-insensitive, ranked matching over label + keywords.
 *
 * The palette runs cmdk with `shouldFilter={false}` and calls this instead, for
 * two reasons: the live half's server results must NOT be re-filtered by a
 * client-side matcher that never saw the row's other columns, and matching that
 * lives in a pure function is testable in this app's vitest, which has no DOM.
 *
 * F-095 part 1: folds both the query and the haystack (§4.1) and ranks a
 * label match ahead of a keyword-only match (§4.3) — `Array#sort` is
 * stable, so entries tied on tier keep their original registration order.
 */
export function filterEntries(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const q = foldWords(query.trim());
  if (!q) return entries;
  const terms = q.split(/\s+/).filter(Boolean);
  const scored: { entry: PaletteEntry; tier: Tier }[] = [];
  for (const entry of entries) {
    const tier = matchTier(entry, terms);
    if (tier !== null) scored.push({ entry, tier });
  }
  scored.sort((a, b) => a.tier - b.tier);
  return scored.map((row) => row.entry);
}
