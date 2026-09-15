/**
 * Resaca Air Conditioning & Heating — the demo tenant.
 *
 * A company that does not exist, in a city that does, doing work the Rio
 * Grande Valley actually needs. "Resaca" is the local word for the oxbow
 * channels the Valley is built around; a real HVAC company here would plausibly
 * be named for one, and no real one is. Harlingen, 956 area code, both
 * languages on the phone, because that is the actual shape of the market this
 * product sells into.
 *
 * WHY THIS FILE IS SEPARATE FROM THE SEEDER
 *
 * Everything here is data, so the safety rules are things a test can ASSERT
 * rather than things a reviewer has to notice. `seed.ts` may only write what
 * this file describes, and this file cannot describe a reachable human:
 *
 *   - Every address is `@example.com`, reserved by RFC 2606 for exactly this.
 *   - Every phone is +1 956 555 01xx. The 555-01xx block is the only NANP
 *     range set aside for fiction; 555 alone is NOT — most of it is assignable
 *     and some of it is assigned.
 *
 * That is defence in depth, not the defence. `accounts.outbound_suppressed`
 * (migration 0032) is what actually stops the every-15-minutes cron from
 * acting on this account. These addresses are the second wall, for the day
 * someone clears the flag to test something and forgets to set it back.
 */

/** RFC 2606 §3: reserved for documentation, never resolvable. */
export const DEMO_EMAIL_DOMAIN = "example.com";

/** The clerk org id. Nobody can sign in as it — no such Clerk organisation
 *  exists — so the account is reachable only by an agency admin, who is
 *  waved past the membership check. The `org_demo_` prefix is how a human
 *  reading the accounts table knows before clicking. */
export const DEMO_ORG_ID = "org_demo_resaca_air";

/** The internal label AND the customer-facing brand name, deliberately the
 *  same. A "(demo)" suffix here would land in the client switcher, in every
 *  screenshot, and in the booking page's title — and it would be decoration,
 *  not a control: `outbound_suppressed` is the thing that makes this account
 *  safe, and a label that looks like a safeguard is worse than no label. */
export const DEMO_ACCOUNT_NAME = "Resaca Air Conditioning & Heating";

/** Harlingen is Central. The whole point of the weekly report and the
 *  reminder window is that they fire in the ACCOUNT's zone, so the demo has
 *  to have a real one. */
export const DEMO_TIMEZONE = "America/Chicago";

/** A cool blue reads as air conditioning and is nobody's trademark. It is
 *  set WITHOUT brand_neutral/corners/type/mode on purpose: `deriveTheme`
 *  returns null unless one of those four is present, so a brand colour alone
 *  never engages the tenant theme. The dashboard therefore keeps BIS's own
 *  chrome — the lit ground and the glass surfaces — while the booking page's
 *  CTA and the client switcher still carry the client's colour and name.
 *  That is the pair worth screenshotting: our aesthetic, their brand. */
export const DEMO_BRAND_COLOR = "#0E6BA8";

/** The REAL demo tenant's business line. Reserved-range, so it can be shown
 *  on a screenshot without sending anybody a call.
 *
 *  `phone_numbers.e164` is unique across EVERY account, not per account, so
 *  this constant is effectively a global lock: exactly one account in the
 *  project may hold it at a time. A seed that fails and leaves its account
 *  behind therefore blocks the next seed with
 *  `duplicate key value violates unique constraint "phone_numbers_e164_key"`
 *  — an error that names nothing about the real problem. That is why
 *  `seedDemoTenant` drops its half-built account on any failure.
 *
 *  And it is why `seedDemoTenant` takes `businessLine` the way it takes
 *  `orgId`: a throwaway tenant that reused this number could only be built
 *  while no demo tenant existed, which made the suite pass or fail on whether
 *  anybody had seeded the demo lately. A throwaway org id does not avoid that
 *  — the org id is not what collides. Its own number is.
 *
 *  THE 01xx BLOCK IS ALLOTTED, and every part of it is spoken for:
 *    00      this line, the real demo tenant's
 *    01-09   throwaway business lines for the test harness
 *    10-49   `DEMO_PEOPLE` — one each, fixed, so reordering moves nothing
 *    50-99   the strangers who call in (`seedCalls`, `seedForm`) */
export const DEMO_BUSINESS_LINE = "+19565550100";

/** Fiction-safe by construction, and asserted rather than trusted.
 *  `+1 956 555 01xx` — the leading `01` is what makes it reserved; plain 555
 *  numbers are assignable and many are assigned. */
export const DEMO_PHONE_RE = /^\+195655501\d{2}$/;
export const DEMO_EMAIL_RE = /^[a-z0-9.\-]+@example\.com$/;

export const demoPhone = (n: number): string => {
  if (!Number.isInteger(n) || n < 0 || n > 99) {
    throw new Error(`demoPhone: ${n} is outside the reserved 01xx block`);
  }
  return `+195655501${String(n).padStart(2, "0")}`;
};

export const demoEmail = (local: string): string =>
  `${local.toLowerCase().replace(/[^a-z0-9.\-]/g, ".")}@${DEMO_EMAIL_DOMAIN}`;

// ---------------------------------------------------------------------------
// The people
// ---------------------------------------------------------------------------

export type DemoPerson = {
  first: string; last: string;
  /** Offset into the reserved 01xx block. Unique across this list. */
  line: number;
  /** Where they came from. Drives the contact's `source` and the mix the
   *  dashboard's attribution reads. */
  source: "call" | "website" | "referral" | "google" | "repeat";
  /** Commercial accounts carry a company; households do not. */
  company?: string;
  /** Their language, which decides which transcript they get. The Valley is
   *  roughly half and half, and a demo that is all English hides the single
   *  most valuable thing this product does here. */
  lang: "en" | "es";
};

/**
 * Forty households and businesses. Surnames are the Valley's actual mix —
 * predominantly Hispanic, with the Anglo and German-Texan names the region
 * also carries — because a demo full of Smiths would not read as Harlingen to
 * anyone who lives here, and this demo is shown to people who do.
 *
 * `line` is assigned explicitly rather than by index so that reordering this
 * list never silently reassigns a phone number between re-seeds.
 */
export const DEMO_PEOPLE: readonly DemoPerson[] = [
  { first: "María",    last: "Guzmán",    line: 10, source: "google",   lang: "es" },
  { first: "Robert",   last: "Kowalski",  line: 11, source: "website",  lang: "en" },
  { first: "Elena",    last: "Treviño",   line: 12, source: "referral", lang: "es" },
  { first: "James",    last: "Whitaker",  line: 13, source: "call",     lang: "en" },
  { first: "Lucía",    last: "Cavazos",   line: 14, source: "google",   lang: "es" },
  { first: "Daniel",   last: "Ochoa",     line: 15, source: "website",  lang: "en" },
  { first: "Patricia", last: "Sáenz",     line: 16, source: "repeat",   lang: "es" },
  { first: "Kevin",    last: "Braun",     line: 17, source: "call",     lang: "en" },
  { first: "Rosa",     last: "Villarreal",line: 18, source: "referral", lang: "es" },
  { first: "Anthony",  last: "Delgado",   line: 19, source: "google",   lang: "en" },
  { first: "Sofía",    last: "Peña",      line: 20, source: "website",  lang: "es" },
  { first: "Mark",     last: "Hinojosa",  line: 21, source: "repeat",   lang: "en" },
  { first: "Adriana",  last: "Lozano",    line: 22, source: "call",     lang: "es" },
  { first: "Gregory",  last: "Muñoz",     line: 23, source: "google",   lang: "en" },
  { first: "Verónica", last: "Alaniz",    line: 24, source: "referral", lang: "es" },
  { first: "Brian",    last: "Escamilla", line: 25, source: "website",  lang: "en" },
  { first: "Norma",    last: "Zamora",    line: 26, source: "call",     lang: "es" },
  { first: "Travis",   last: "Bueno",     line: 27, source: "google",   lang: "en" },
  { first: "Claudia",  last: "Ramírez",   line: 28, source: "repeat",   lang: "es" },
  { first: "Derek",    last: "Salinas",   line: 29, source: "website",  lang: "en" },
  { first: "Yolanda",  last: "Barrera",   line: 30, source: "referral", lang: "es" },
  { first: "Nathan",   last: "Cisneros",  line: 31, source: "call",     lang: "en" },
  { first: "Gabriela", last: "Montalvo",  line: 32, source: "google",   lang: "es" },
  { first: "Wesley",   last: "Fuentes",   line: 33, source: "website",  lang: "en" },
  { first: "Irma",     last: "Chapa",     line: 34, source: "repeat",   lang: "es" },
  { first: "Corey",    last: "Ybarra",    line: 35, source: "google",   lang: "en" },
  { first: "Beatriz",  last: "Silva",     line: 36, source: "call",     lang: "es" },
  { first: "Philip",   last: "Garza",     line: 37, source: "referral", lang: "en" },
  { first: "Mónica",   last: "Esquivel",  line: 38, source: "website",  lang: "es" },
  { first: "Shane",    last: "Longoria",  line: 39, source: "google",   lang: "en" },

  // The commercial side of the book. An HVAC company's revenue is not evenly
  // spread across forty houses, and a pipeline that pretends otherwise makes
  // the board look like a toy.
  { first: "Andrea",  last: "Cantú",     line: 40, source: "referral", lang: "es",
    company: "Cantú Family Dental" },
  { first: "Paul",    last: "Rangel",    line: 41, source: "call",     lang: "en",
    company: "Rangel Auto Glass" },
  { first: "Diana",   last: "Ibarra",    line: 42, source: "referral", lang: "es",
    company: "Arroyo Grande Apartments" },
  { first: "Curtis",  last: "Nowak",     line: 43, source: "google",   lang: "en",
    company: "Harlingen Self Storage" },
  { first: "Leticia", last: "Maldonado", line: 44, source: "repeat",   lang: "es",
    company: "Panadería La Reina" },
  { first: "Owen",    last: "Serrato",   line: 45, source: "website",  lang: "en",
    company: "Valley Print Works" },
  { first: "Silvia",  last: "Requena",   line: 46, source: "referral", lang: "es",
    company: "Requena Insurance Group" },
  { first: "Blake",   last: "Tijerina",  line: 47, source: "call",     lang: "en",
    company: "Tijerina Roofing" },
  { first: "Alma",    last: "Bazán",     line: 48, source: "google",   lang: "es",
    company: "Bazán Daycare Center" },
  { first: "Trent",   last: "Villanueva",line: 49, source: "repeat",   lang: "en",
    company: "Los Fresnos Feed & Supply" },
] as const;

/** What Sofía says she does, and what the booking page says the visit is.
 *  Written to the DESIGN.md copy rule: a business owner reads this at 7 AM. */
export const DEMO_SERVICES = [
  "A/C repair", "Heating repair", "System replacement",
  "Maintenance plans", "Duct cleaning", "Commercial rooftop units",
] as const;
