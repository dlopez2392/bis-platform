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

/**
 * How the reserved block is divided, and why the split is not arbitrary.
 *
 * `+1 956 555 01xx` is exactly 100 numbers, and the three uses the seed puts
 * them to are NOT interchangeable, because only one of them is constrained by
 * the database. A contact's `phone` and a call's caller id are ordinary
 * columns — two accounts may hold the same value all day. `phone_numbers.e164`
 * is unique across EVERY account in the project. So the block is split with
 * the scarce use first and given room to breathe:
 *
 *   00-09  business lines — one per seeded account, globally unique
 *   10-49  the forty contacts
 *   50-99  callers who are not in the book yet
 *
 * Nine spare business-line slots is not a cushion against nothing. This repo
 * has ONE Supabase project, and `demo-seed.test.ts` seeds a throwaway account
 * in it to prove the seeder end to end — so the real demo and a test run must
 * be able to coexist. They could not, and the day danlo first seeded the real
 * demo, every CI run after it went red on
 * `duplicate key value violates unique constraint "phone_numbers_e164_key"`,
 * on a pull request whose entire diff was a workflow file. An error that names
 * nothing about the real problem is the signature of this whole class of bug.
 */
export const BUSINESS_LINE_SLOTS = { first: 0, last: 9 } as const;
export const CONTACT_LINE_SLOTS = { first: 10, last: 49 } as const;
export const CALLER_LINE_SLOTS = { first: 50, last: 99 } as const;

/** The canonical demo's business line — slot 00, and PINNED there.
 *
 *  Unlike a throwaway's line, this number is not an implementation detail:
 *  it is on the Voice settings screen, it is what an operator reads back to
 *  themselves when checking the demo is alive, and it will be in screenshots
 *  on the marketing site. A number that moved between seeds would quietly
 *  invalidate whatever had already been captured, so `demoBusinessLines`
 *  offers this and nothing else for `DEMO_ORG_ID`: if 00 is held by some
 *  other account, the right outcome is a loud failure naming the holder, not
 *  a demo that silently answers on a different line. */
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

/**
 * FNV-1a over the org id. Not for security — for a stable, well-spread
 * starting point, so two throwaway org ids seeded in the same project
 * overwhelmingly begin their search at different slots instead of both
 * walking from 01 and contending on every run.
 */
function hashOrgId(orgId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < orgId.length; i++) {
    h ^= orgId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The business lines this org may take, in the order it should try them.
 *
 * The canonical demo gets exactly one candidate, for the reason on
 * `DEMO_BUSINESS_LINE`. Every other seedable org — which in practice means
 * `demo-seed.test.ts`'s throwaway — gets all nine spare slots, ordered from a
 * hash of its own id, so the caller can take the first one nobody holds.
 *
 * A LIST rather than a single derived number on purpose. Hashing nine slots
 * would collide roughly one run in nine if two seeds ever overlapped, and
 * "CI is red once every nine pushes" is the worst possible failure mode: rare
 * enough to be dismissed as a flake, frequent enough to cost real time. Nine
 * ordered candidates make a collision impossible below nine concurrent
 * accounts, and if all nine are genuinely taken the caller says so in those
 * words — which is the truth (nine orphans) and is actionable.
 */
export function demoBusinessLines(orgId: string): string[] {
  if (orgId === DEMO_ORG_ID) return [DEMO_BUSINESS_LINE];
  const spare = Array.from(
    { length: BUSINESS_LINE_SLOTS.last - BUSINESS_LINE_SLOTS.first },
    (_, i) => BUSINESS_LINE_SLOTS.first + 1 + i);
  const start = hashOrgId(orgId) % spare.length;
  return [...spare.slice(start), ...spare.slice(0, start)].map(demoPhone);
}

/**
 * The site's Vercel project id — the second value that is unique across every
 * account, and the one that would have failed the instant the phone was fixed.
 *
 * Derived from the org id rather than fixed, so the demo and a test run can
 * both have a linked site. The `org_` prefix is dropped so the canonical demo
 * keeps the exact string it has always had (`prj_demo_resaca_air_...`) — this
 * fix changes what a THROWAWAY writes, and nothing about the real demo.
 *
 * Deliberately unmistakable: nobody hunting a broken analytics sync should
 * spend a minute looking for this in the Vercel dashboard. Nothing will ever
 * call Vercel with it anyway — `listSitesToSync` filters suppressed accounts
 * out server-side — but the name is the second wall, the same way
 * `@example.com` is.
 */
export const demoVercelProjectId = (orgId: string): string =>
  `prj_${orgId.replace(/^org_/, "")}_not_a_real_project`;

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

/**
 * The booking calendar's opening hours — and they are NOT decoration.
 *
 * `calendars.enabled` defaults to false, and `/b/[publicId]` answers a
 * disabled calendar with `notFound()` (b/[publicId]/page.tsx). The first
 * capture run therefore photographed a 404 and uploaded it as one of six
 * marketing screenshots, because a 404 is still a valid PNG and
 * `if-no-files-found: error` only catches files that are MISSING, not files
 * that are wrong.
 *
 * The windows deliberately match, to the hour, what `seedVoice` has Sofía
 * say out loud ("Monday to Friday 8 AM to 5 PM, Saturday 8 AM to noon").
 * A demo whose booking page contradicts its own receptionist is a demo that
 * loses the argument in the one screenshot where both are visible.
 */
export const DEMO_OPEN_HOURS: Record<string, [string, string][]> = {
  mon: [["08:00", "17:00"]],
  tue: [["08:00", "17:00"]],
  wed: [["08:00", "17:00"]],
  thu: [["08:00", "17:00"]],
  fri: [["08:00", "17:00"]],
  sat: [["08:00", "12:00"]],
};

/** The sending identity. Reserved domain, like every other address here —
 *  `outbound_suppressed` is what actually stops the cron, this is the second
 *  wall. It exists so the setup checklist's "email" step reads done: a demo
 *  that shows its own product half-configured argues against the product. */
export const DEMO_FROM_EMAIL = "resaca.air@example.com";

/**
 * The one checklist item with no derivable source.
 *
 * Eight of the nine setup steps are COMPUTED from live rows, which is the
 * wizard's whole promise. "I forwarded my number" cannot be — no row proves
 * a carrier-side change — so it is a stored tick, and the demo has to set it
 * the way a real operator would.
 *
 * THIS STRING IS MIRRORED in apps/web's `SETUP_TICK_KEYS.forwardingDone`.
 * Duplicated rather than imported because the dependency only runs one way
 * (apps/web depends on @bis/db, never the reverse), and this repo has been
 * bitten before by two hand-maintained copies drifting apart — so
 * `setup-status.test.ts` over there asserts the two are identical rather
 * than trusting a comment.
 */
export const DEMO_FORWARDING_TICK_KEY = "setup:forwarding_done";

/** What Sofía says she does, and what the booking page says the visit is.
 *  Written to the DESIGN.md copy rule: a business owner reads this at 7 AM. */
export const DEMO_SERVICES = [
  "A/C repair", "Heating repair", "System replacement",
  "Maintenance plans", "Duct cleaning", "Commercial rooftop units",
] as const;
