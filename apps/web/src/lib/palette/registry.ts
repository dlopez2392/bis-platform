import { buildNavGroups } from "@/lib/nav-groups";
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
 * Settings sections, each pointing at an anchor on the settings page.
 *
 * DESIGN.md's command-palette pattern ends with "Settings sections must be
 * registered in the palette index" — this list IS that index, and the anchors
 * match the `id` attributes on the page's own sections. Settings is gated by
 * `requireAgencyOnlyAccountAccess` (settings/page.tsx), so every entry here is
 * agency-only.
 */
const SETTINGS_SECTIONS: { anchor: string; labelKey: MessageKey; keywords: string[] }[] = [
  // F-095 part 1 (spec §4.2): "acceso"/"invitación" added — "portal" is
  // already shared between the two languages, so it is not repeated.
  { anchor: "client-access", labelKey: "palette.settings.clientAccess", keywords: ["login", "invite", "portal", "acceso", "invitación"] },
  { anchor: "sending-address", labelKey: "palette.settings.sendingAddress", keywords: ["email", "from", "domain", "never record", "block", "ignore sender", "correo", "dominio", "remitente"] },
  // "crm" is already shared between the two languages.
  { anchor: "custom-fields", labelKey: "palette.settings.customFields", keywords: ["field", "crm", "campo"] },
  // "variable" is already shared between the two languages.
  { anchor: "custom-values", labelKey: "palette.settings.customValues", keywords: ["value", "variable", "merge", "valor"] },
  { anchor: "alert-phone", labelKey: "palette.settings.alertPhone", keywords: ["sms", "text", "notify", "lead alert", "texto", "alerta", "aviso"] },
  // "plan" is already shared between the two languages.
  { anchor: "billing", labelKey: "palette.settings.billing", keywords: ["plan", "subscription", "invoice", "stripe", "complimentary", "payment", "suscripción", "factura", "pago"] },
  // D-080: three real cards on this same page (settings/page.tsx's
  // <BrandingPanel>, <WeeklyReportCard id="weekly-report">, <LinkSiteCard
  // id="website">) had no entry here at all.
  { anchor: "branding", labelKey: "palette.settings.branding", keywords: ["logo", "colors", "theme", "brand name", "logotipo", "colores", "marca"] },
  { anchor: "weekly-report", labelKey: "palette.settings.weeklyReport", keywords: ["email report", "monday", "recipients", "reporte", "lunes", "destinatarios"] },
  { anchor: "website", labelKey: "palette.settings.website", keywords: ["analytics", "traffic", "vercel", "domain", "link site", "tráfico", "análisis", "dominio"] },
  // S-07 2c: the required-documents list (settings/required-documents-card.tsx)
  { anchor: "required-documents", labelKey: "palette.settings.requiredDocuments", keywords: ["documents", "checklist", "required", "missing", "vault", "documentos", "requeridos"] },
  // Item 8a-1: the agency's AI card (settings/ai-card.tsx, #ai).
  { anchor: "ai", labelKey: "palette.settings.ai", keywords: ["ai", "budget", "spend", "switch", "summaries", "suggestions", "ia", "presupuesto"] },
  // S-53: the company's trade (settings/trade-card.tsx, #trade).
  { anchor: "trade", labelKey: "palette.settings.trade", keywords: ["trade", "industry", "business type", "vetting", "giro", "restaurant", "sofia", "web chat"] },
];

/** Extra search words per nav destination, keyed by the href SUFFIX so this
 *  survives a base change. A destination with no entry simply has none. */
const NAV_KEYWORDS: Record<string, string[]> = {
  // F-095 part 1 (spec §4.2): "inicio" also means "sign-in" per the glossary's
  // own exclusion note — kept anyway since it is still the right word for
  // THIS destination; the exclusion only bans it as a stand-in elsewhere.
  "/dashboard": ["home", "overview", "inicio", "panel"],
  "/contacts": ["people", "customers", "leads", "contactos", "clientes", "prospectos"],
  // S-07 3a (spec 3.1): the document vault's account-wide list.
  "/documents": ["files", "vault", "expiring", "expired", "expiry", "insurance", "permit", "license", "warranty", "documentos", "archivos", "vencen", "vencidos"],
  "/pipeline": ["deals", "opportunities", "sales", "oportunidades", "embudo"],
  "/conversations": ["messages", "inbox", "sms", "email", "conversaciones", "mensajes", "bandeja"],
  "/calls": ["phone", "receptionist", "sofia", "llamadas", "teléfono"],
  // "activity" added 2026-09-21 (cleanup item 2): the nav label changed to
  // "What went out" to stop colliding with the dashboard's own Activity
  // card, but the old word should still find this page.
  "/activity": ["history", "activity", "what went out", "sent", "waiting", "held", "skipped", "quiet hours", "usage", "log"],
  "/forms": ["lead form", "intake", "formularios"],
  // "closed days"/"holiday"/"vacation"/"días cerrados"/"feriado"/"vacaciones" added S-47d (spec 5.6.3):
  // the Closed days card.
  // "phone calendar"/"subscribe"/"ical"/"ics"/"iphone"/"google calendar"/"outlook"/"calendario del teléfono"/
  // "suscribirse" added F-048 part 2: the Bookings on your phone card.
  "/calendar": ["booking", "availability", "hours", "closed days", "holiday", "vacation", "días cerrados", "feriado", "vacaciones",
    "phone calendar", "subscribe", "ical", "ics", "iphone", "google calendar", "outlook", "calendario del teléfono", "suscribirse",
    // F-046 part 1: the agenda card.
    "agenda", "schedule", "add job", "trabajo", "agregar trabajo",
    // F-095 part 1 (spec §4.2): "cita" is the glossary's word for
    // appointment/booking — the brief's own worked example.
    "citas", "horario", "disponibilidad"],
  "/tasks": ["task", "tasks", "to-do", "todo"],
  "/branding": ["logo", "colors", "theme", "marca", "logotipo", "colores"],
  // "hours"/"prices"/"services"/"horario"/"precios" added S-47c (spec 5.7): the Business hours and
  // Services & prices cards.
  "/voice": ["receptionist", "sofia", "ai", "website", "widget", "chat", "concierge", "bubble", "transfer", "forward", "person", "phones", "hours", "prices", "services", "horario", "precios"],
  "/automations": ["no-show", "no show", "text reminder", "reminder", "reviews", "review requests", "google review", "follow up", "text", "referral", "reactivation", "quote", "confirmation", "instant reply"],
  "/dashboard/accounts": ["companies", "clients"],
  "/dashboard/blueprints": ["templates"],
  "/dashboard/numbers": ["phone", "telnyx", "did", "line", "inventory", "reassign"],
  "/dashboard/screened": ["refused", "blocked", "spam", "declined", "rejected", "turned away"],
  "/dashboard/plans": ["billing", "pricing", "stripe", "subscription", "tier", "allowance", "overage"],
  "/billing": ["invoice", "invoices", "card", "payment", "plan", "subscription", "receipt"],
};

function keywordsFor(href: string, base: string | null): string[] {
  const suffix = base && href.startsWith(base) ? href.slice(base.length) : href;
  return NAV_KEYWORDS[suffix] ?? [];
}

/**
 * Every palette destination and action for this caller.
 *
 * Navigation entries are DERIVED from `buildNavGroups` rather than re-listed,
 * so a nav destination cannot exist without a palette entry — which is exactly
 * what DESIGN.md's registration rule asks for, enforced by construction rather
 * than by a promise. `registry.test.ts` asserts the parity in both roles.
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

  // A Technician (F-085 part 1, spec §9): the nav already leaves out every
  // route they cannot enter, so deriving from it leaves them out here too.
  for (const group of buildNavGroups(base, isAgency, isOwner, isTechnician)) {
    for (const item of group.items) {
      entries.push({
        kind: "href",
        id: `nav:${item.href}`,
        label: label(item.labelKey),
        group: "navigation",
        agencyOnly: false, // buildNavGroups already withheld agency-only items
        keywords: words(item.labelKey, keywordsFor(item.href, base)),
        labelKey: item.labelKey,
        href: item.href,
      });
    }
  }

  // Mis preferencias (F-096, Task 6): a person's OWN page, not an
  // account's, so it is offered to every caller, with or without an account
  // in scope. Not a nav item (it lives in the user menu), so registered here.
  entries.push({
    kind: "href", id: "nav:preferences", label: label("prefs.palette"), group: "navigation", agencyOnly: false,
    keywords: ["preferences", "language", "idioma", "español", "spanish", "english", "theme", "dark", "light", "appearance", "my"],
    labelKey: "prefs.palette",
    href: "/dashboard/preferences",
  });

  // Staff and roles (Task 8): a client Owner reaches team management
  // directly — the sidebar footer's own destination, not a Settings-page
  // anchor, so it is registered like any other nav destination rather than
  // through SETTINGS_SECTIONS below. Staff never get this entry, nor does a
  // Technician (never an Owner).
  if (base && !isAgency && isOwner) {
    entries.push({
      kind: "href",
      id: "nav:team",
      label: label("nav.team"),
      group: "navigation",
      agencyOnly: false,
      // "equipo" (F-095 part 1): nav.team's own Spanish label — the word
      // itself was missing, so an English-locale session could not find
      // this entry by it (registry.test.ts's completeness check, §4.4).
      keywords: ["team", "staff", "people", "invite", "users", "logins", "employees", "equipo"],
      labelKey: "nav.team",
      href: `${base}/team`,
    });
  }

  // S-07 3a (spec 3.3): a client Owner edits the required-documents list on
  // the Documents page's own card (#required-documents). The agency keeps
  // Settings' card (SETTINGS_SECTIONS); Staff and a Technician get neither.
  if (base && !isAgency && isOwner) {
    entries.push({
      kind: "href", id: "nav:required-documents", label: label("palette.settings.requiredDocuments"), group: "navigation", agencyOnly: false,
      keywords: ["documents", "checklist", "required", "missing", "documentos", "requeridos"],
      labelKey: "palette.settings.requiredDocuments",
      href: `${base}/documents#required-documents`,
    });
  }

  // F-118 part 1 (owner ruling 9): the Team page's own "BIS access"
  // section — every visit BIS has made to this account, its reason and
  // what it opened — reached by an Owner directly and by the agency.
  // Staff and a Technician never get this entry, and never reach the Team
  // page at all (requireAccountOwner itself keeps them off it, so hiding
  // this entry is convenience, not the authorization — same discipline as
  // every other entry in this file).
  if (base && (isAgency || isOwner)) {
    entries.push({
      kind: "href", id: "nav:bis-access", label: label("accessLog.title"), group: "navigation", agencyOnly: false,
      keywords: ["bis", "access", "log", "visits", "who looked", "acceso", "registro", "visitas"],
      labelKey: "accessLog.title",
      href: `${base}/team#bis-access`,
    });
  }

  if (base && isAgency) {
    entries.push({
      kind: "href",
      id: "nav:settings",
      label: label("nav.settings"),
      group: "navigation",
      agencyOnly: true,
      // "ajustes" (F-095 part 1): nav.settings' own Spanish label
      // (messages.ts's "nav.settings.es"). Never "configuración"/
      // "configuracion" here — the glossary bans that word for Settings
      // (i18n/spanish-style.ts's G6 "settings" rule); those two keywords
      // belong to nav:setup below (spec §0/§7's corrected mapping).
      keywords: ["configuration", "preferences", "ajustes"],
      labelKey: "nav.settings",
      href: `${base}/settings`,
    });
    entries.push({
      kind: "href",
      id: "nav:setup",
      label: label("nav.setup"),
      group: "navigation",
      agencyOnly: true,
      // "configuración"/"configuracion" (F-095 part 1, spec §0/§7): the
      // brief's own worked example, corrected against the shipped glossary
      // — "Configuración" is nav.setup's Spanish label (not Settings').
      // Both forms are kept (the fold handles either), documenting intent.
      keywords: ["wizard", "activation", "onboarding", "go live", "configuración", "configuracion"],
      labelKey: "nav.setup",
      href: `${base}/setup`,
    });
    // The agency's own entry point into this client's team management: the
    // Team page (`/team`), which admits the agency and shows the same card
    // as Settings. Not a SETTINGS_SECTIONS anchor, although Settings does
    // carry an `id="team"` card since Task 10: that card renders only while
    // client access is on (spec §8), so `settings#team` would scroll to
    // nothing whenever access is off, which is the defect registry.test.ts's
    // anchor-parity check (D-080) exists to catch. /team always answers,
    // with the access-off note when access is off. A plain navigation entry
    // (`group: "navigation"`) like `nav:settings`/`nav:setup` above, keeping
    // the `palette.settings.team` label and its keywords, so the agency finds
    // it by typing "team" or "staff".
    entries.push({
      kind: "href",
      id: "settings:team",
      label: label("palette.settings.team"),
      group: "navigation",
      agencyOnly: true,
      // "equipo" (F-095 part 1): palette.settings.team's own Spanish label.
      keywords: ["team", "staff", "invite", "logins", "people", "equipo"],
      labelKey: "palette.settings.team",
      href: `${base}/team`,
    });
    for (const section of SETTINGS_SECTIONS) {
      entries.push({
        kind: "href",
        id: `settings:${section.anchor}`,
        label: label(section.labelKey),
        group: "settings",
        agencyOnly: true,
        keywords: words(section.labelKey, section.keywords),
        labelKey: section.labelKey,
        href: `${base}/settings#${section.anchor}`,
      });
    }
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
