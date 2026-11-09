import { describe, it, expect, vi, beforeEach } from "vitest";
import { Suspense, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The Team page (staff and roles, spec §8): the client Owner's own route,
 * which the agency reaches too. requireAccountOwner is the boundary (a
 * client Staff is sent to their dashboard), so it runs before anything is
 * read. Called, not rendered (billing/page.test.ts's form).
 *
 * F-118 part 1 (plan Task 10; spec 6.1): below TeamSection, the BIS access
 * section lives in its OWN Suspense inside its OWN frame (`BisAccessFrame`,
 * real — not mocked, so its `id="bis-access"` is real markup), reading its
 * own data (`BisAccessSection`, mocked the same way `TeamSection` is: a
 * sync stub, since react-dom/server cannot render an unmocked async Server
 * Component). `all()`'s `.find()` returns the FIRST Suspense in the tree, so
 * every PRE-EXISTING assertion below still finds TeamSection's own boundary
 * unchanged.
 *
 * F-032 Task 6: between TeamSection's Suspense and the BIS access frame, the
 * owner line's switch card reads `readOwnerLineSwitch`/`readAccountTimezone`
 * on `serviceDb()` — the same partial-`@bis/db`-mock shape billing/page.test.ts
 * already uses (`importOriginal` plus the two owner-line reads), so every
 * other `@bis/db` export (types included) stays real.
 */
const guard = vi.hoisted(() => ({ allowed: true, isAgency: false, order: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  requireAccountOwner: async (id: string) => {
    guard.order.push(`guard:${id}`);
    if (!guard.allowed) throw new Error("NEXT_REDIRECT");
    return { userId: "user_x", isAgency: guard.isAgency };
  },
}));
const ownerLineMock = vi.hoisted(() => ({
  state: { enabledAt: null, changedAt: null, changedByKind: null } as
    { enabledAt: string | null; changedAt: string | null; changedByKind: "owner" | "agency" | null },
  zone: null as string | null,
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => ({ tag: "service" }),
  readOwnerLineSwitch: async () => ownerLineMock.state,
  readAccountTimezone: async () => ownerLineMock.zone,
}));
const accountRow = vi.hoisted(() => ({
  language: null as "en" | "es" | null,
  error: null as { code: string; message: string } | null,
}));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => {
    guard.order.push("db");
    return {
      from: () => {
        const c = {
          select: () => c,
          eq: () => c,
          maybeSingle: async () => (accountRow.error
            ? { data: null, error: accountRow.error }
            : { data: { clerk_org_id: "org_9", language: accountRow.language }, error: null }),
        };
        return c;
      },
    };
  },
}));
// S-10 T6: the page now resolves its own locale (requestLocale +
// getPersonPrefs), same reason calls/page.test.ts and billing/page.test.ts
// already stub this — person-prefs pulls in @/lib/auth's
// resolveClientAccessState through tenant-theme-reader.ts, which this
// file's own @/lib/auth mock does not define.
const prefs = vi.hoisted(() => ({ language: null as "en" | "es" | null }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: prefs.language, theme: null }) }));
const section = vi.hoisted(() => ({
  TeamSection: () => null,
  BisAccessSection: () => null,
}));
vi.mock("@/components/team/team-section", () => ({ TeamSection: section.TeamSection }));
vi.mock("@/components/access-log/bis-access-section", () => ({ BisAccessSection: section.BisAccessSection }));

const { default: TeamPage } = await import("./page");
const { TeamSkeleton } = await import("@/components/team/team-card");
const { BisAccessFrame } = await import("@/components/access-log/bis-access-frame");
const { BisAccessSkeleton } = await import("@/components/access-log/bis-access-skeleton");
const { OwnerLineSwitchCard } = await import("@/components/owner-line/owner-line-switch-card");

function all(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...all(el.props.children as ReactNode)];
}
const page = (searchParams?: { accessBefore?: string; locale?: string }) =>
  TeamPage({ params: Promise.resolve({ accountId: "a1" }), searchParams: Promise.resolve(searchParams ?? {}) });

beforeEach(() => {
  guard.allowed = true;
  guard.isAgency = false;
  guard.order = [];
  accountRow.language = null;
  accountRow.error = null;
  prefs.language = null;
  ownerLineMock.state = { enabledAt: null, changedAt: null, changedByKind: null };
  ownerLineMock.zone = null;
});

describe("the Team page", () => {
  it("requireAccountOwner is its first call: a Staff (redirected) gets nothing back (mutation: drop the guard -> FAILS)", async () => {
    guard.allowed = false;
    await expect(page()).rejects.toThrow("NEXT_REDIRECT");
    expect(guard.order).toEqual(["guard:a1"]);
  });

  it("mounts TeamSection for THIS account in its own Suspense (mutation: render it outside Suspense -> FAILS), the shared skeleton as fallback", async () => {
    const els = all(await page());
    // Fix round 1, M5: the page read nothing of the TEAM data itself (that
    // stays TeamSection's own read, team-section.test.ts); S-10 T6 adds
    // exactly one lightweight read here, `language` only, for the page's
    // own chrome locale (the same shape billing/page.tsx and
    // branding/page.tsx already use) — one "db" call, not a second full
    // account row.
    expect(guard.order).toEqual(["guard:a1", "db"]);
    const boundary = els.find((e) => e.type === Suspense);
    expect(boundary).toBeTruthy();
    const fallback = boundary!.props.fallback as ReactElement;
    expect(isValidElement(fallback) && fallback.type).toBe(TeamSkeleton);
    const child = boundary!.props.children as ReactElement<Record<string, unknown>>;
    expect(child.type).toBe(section.TeamSection);
    expect(child.props).toEqual({ accountId: "a1", viewer: "owner", locale: "en", pseudo: false });
  });

  it("the agency sees the agency's copy (mutation: viewer always owner -> FAILS)", async () => {
    guard.isAgency = true;
    const boundary = all(await page()).find((e) => e.type === Suspense)!;
    expect((boundary.props.children as ReactElement<Record<string, unknown>>).props.viewer).toBe("agency");
  });

  // S-10 T6: the page resolved no locale at all; the title/subtitle, the
  // fallback skeleton and TeamSection all read English regardless of the
  // reader's own stored choice.
  it("resolves the reader's locale (person, then account, then English) and threads it to TeamSection and the fallback skeleton (mutation: default to 'en' unconditionally -> FAILS)", async () => {
    prefs.language = "es";
    const els = all(await page());
    const boundary = els.find((e) => e.type === Suspense)!;
    const child = boundary.props.children as ReactElement<Record<string, unknown>>;
    expect(child.props.locale).toBe("es");
    const fallback = boundary.props.fallback as ReactElement<Record<string, unknown>>;
    expect(fallback.props.locale).toBe("es");
  });

  it("the title and subtitle read in Spanish (mutation: hard-code m[key] -> FAILS)", async () => {
    prefs.language = "es";
    const { m } = await import("@/lib/messages");
    const { PageHeader } = await import("@/components/page-header");
    const header = all(await page()).find((e) => e.type === PageHeader)!;
    expect(header.props).toMatchObject({ title: m["team.title.es"], subtitle: m["team.page.subtitle.es"] });
  });

  it("an operator's OWN choice wins over the client account's language (mutation: pass isOperator the wrong way -> FAILS)", async () => {
    guard.isAgency = true;
    accountRow.language = "es";
    const els = all(await page());
    const boundary = els.find((e) => e.type === Suspense)!;
    const child = boundary.props.children as ReactElement<Record<string, unknown>>;
    expect(child.props.locale).toBe("en");
  });

  // Review fix round (S-10 T6, I-2): a failed account-language read used to
  // THROW (the .then() callback's `if (error) throw`), which rejects the
  // Promise.all and replaces the whole page — header, Team card and BIS
  // access section alike — with the dashboard's error boundary. Fails soft
  // like branding/page.tsx's own equivalent read: log it, fall back to no
  // account language (English, absent the person's own choice), and keep
  // rendering everything else.
  it("a failed account-language read logs it and still renders the header and the Team card, in English (mutation: throw instead of falling back -> FAILS)", async () => {
    accountRow.error = { code: "XX000", message: "internal error" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const tree = await page();
    const els = all(tree);
    const { PageHeader } = await import("@/components/page-header");
    const { m } = await import("@/lib/messages");
    const header = els.find((e) => e.type === PageHeader)!;
    expect(header.props).toMatchObject({ title: m["team.title"], subtitle: m["team.page.subtitle"] });
    const boundary = els.find((e) => e.type === Suspense)!;
    expect((boundary.props.children as ReactElement<Record<string, unknown>>).type).toBe(section.TeamSection);
    expect((boundary.props.children as ReactElement<Record<string, unknown>>).props).toMatchObject({ locale: "en" });
    const lines = err.mock.calls.map((c) => String(c[0]));
    const line = lines.find((l) => l.startsWith("team page: account a1 language read failed:"));
    expect(line, lines.join("\n")).toBeDefined();
    expect(line).toContain("XX000");
    err.mockRestore();
  });
});

// F-032 Task 6 (spec §3.3): the owner line's switch card, between TeamSection's own Suspense and the BIS access
// frame, reading `readOwnerLineSwitch`/`readAccountTimezone` after requireAccountOwner.
describe("the Team page: owner line switch card (F-032 Task 6)", () => {
  it("renders between TeamSection's Suspense and the BIS access frame, with the state, viewer, locale and a zone fallback, and a bound setSwitch (mutation: drop the America/Chicago fallback -> FAILS)", async () => {
    ownerLineMock.state = { enabledAt: "2026-11-09T19:00:00Z", changedAt: "2026-11-09T19:00:00Z", changedByKind: "owner" };
    ownerLineMock.zone = null;
    const els = all(await page());
    const suspenseIdx = els.findIndex((e) => e.type === Suspense);
    const switchIdx = els.findIndex((e) => e.type === OwnerLineSwitchCard);
    const frameIdx = els.findIndex((e) => e.type === BisAccessFrame);
    expect(switchIdx, "no OwnerLineSwitchCard element found").toBeGreaterThan(-1);
    expect(switchIdx).toBeGreaterThan(suspenseIdx);
    expect(switchIdx).toBeLessThan(frameIdx);
    const card = els[switchIdx]!;
    expect(card.props).toMatchObject({ state: ownerLineMock.state, viewer: "owner", locale: "en", zone: "America/Chicago", pseudo: false });
    expect(typeof card.props.setSwitch).toBe("function");
  });

  it("threads the agency viewer through, same as TeamSection (mutation: hardcode viewer owner -> FAILS)", async () => {
    guard.isAgency = true;
    const card = all(await page()).find((e) => e.type === OwnerLineSwitchCard)!;
    expect(card.props.viewer).toBe("agency");
  });

  it("passes through a real account zone when one is stored, instead of the fallback (mutation: ignore zoneRead -> FAILS)", async () => {
    ownerLineMock.zone = "America/Denver";
    const card = all(await page()).find((e) => e.type === OwnerLineSwitchCard)!;
    expect(card.props.zone).toBe("America/Denver");
  });
});

// F-118 part 1 (plan Task 10; spec 6.1): the BIS access section, below Team,
// readable by the client's Owner and by the agency — never by Staff or a
// Technician, who never even reach this page (requireAccountOwner above).
describe("the Team page: BIS access (F-118 part 1)", () => {
  it("renders the frame with id=\"bis-access\" as real markup, for an Owner and for the agency (mutation: drop BisAccessFrame -> FAILS)", async () => {
    for (const isAgency of [false, true]) {
      guard.isAgency = isAgency;
      const html = renderToStaticMarkup(await page());
      expect(html).toContain('id="bis-access"');
    }
  });

  it("mounts BisAccessSection for THIS account, with isAgency, inside its own Suspense (the shared BisAccessSkeleton as fallback) inside the frame (mutations: drop the frame -> FAILS; render the Suspense outside the frame -> FAILS)", async () => {
    const els = all(await page());
    const frame = els.find((e) => e.type === BisAccessFrame);
    expect(frame).toBeTruthy();
    const inner = all(frame!.props.children as ReactNode);
    const boundary = inner.find((e) => e.type === Suspense);
    expect(boundary).toBeTruthy();
    const fallback = boundary!.props.fallback as ReactElement;
    expect(isValidElement(fallback) && fallback.type).toBe(BisAccessSkeleton);
    const child = boundary!.props.children as ReactElement<Record<string, unknown>>;
    expect(child.type).toBe(section.BisAccessSection);
    expect(child.props).toEqual({ accountId: "a1", isAgency: false, before: undefined });
  });

  it("passes isAgency through for the agency too (mutation: hardcode isAgency -> FAILS)", async () => {
    guard.isAgency = true;
    const els = all(await page());
    const frame = els.find((e) => e.type === BisAccessFrame)!;
    const boundary = all(frame.props.children as ReactNode).find((e) => e.type === Suspense)!;
    const child = boundary.props.children as ReactElement<Record<string, unknown>>;
    expect(child.props.isAgency).toBe(true);
  });

  it("passes this request's OWN accessBefore cursor to the section (mutation: drop accessBefore -> FAILS)", async () => {
    const els = all(await page({ accessBefore: "CURSOR123" }));
    const frame = els.find((e) => e.type === BisAccessFrame)!;
    const boundary = all(frame.props.children as ReactNode).find((e) => e.type === Suspense)!;
    const child = boundary.props.children as ReactElement<Record<string, unknown>>;
    expect(child.props.before).toBe("CURSOR123");
  });

  it("threads the request's ?locale= (the QA override) to the section, as documents/page.tsx does (mutation: drop it -> FAILS)", async () => {
    const els = all(await page({ locale: "pseudo" }));
    const frame = els.find((e) => e.type === BisAccessFrame)!;
    const boundary = all(frame.props.children as ReactNode).find((e) => e.type === Suspense)!;
    const child = boundary.props.children as ReactElement<Record<string, unknown>>;
    expect(child.props.qaLocale).toBe("pseudo");
  });
});

// I2 (review fix round): the page passed `pseudo={pseudo}` to TeamSection
// AND to the fallback TeamSkeleton, but nothing proved either survived a
// mutation back to `pseudo={false}` — every PRE-EXISTING test above
// renders with no `BIS_I18N_QA`/`?locale=pseudo` at all, so `pseudo: false`
// (the correct DEFAULT answer) was indistinguishable from a hard-coded one.
describe("the Team page — pseudo wiring (I2, review fix round)", () => {
  it("under BIS_I18N_QA + ?locale=pseudo, pseudo=true reaches TeamSection and the fallback TeamSkeleton (mutation: pseudo={false} on either → FAILS)", async () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      const els = all(await page({ locale: "pseudo" }));
      const boundary = els.find((e) => e.type === Suspense)!;
      const child = boundary.props.children as ReactElement<Record<string, unknown>>;
      expect(child.props.pseudo).toBe(true);
      const fallback = boundary.props.fallback as ReactElement<Record<string, unknown>>;
      expect(fallback.props.pseudo).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
