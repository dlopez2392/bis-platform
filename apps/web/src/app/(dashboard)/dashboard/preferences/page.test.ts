import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * Mis preferencias' owner-line cards (F-032 Task 6; final review I-3, M-1; design review Critical 1, Important 4;
 * owner ruling 2026-11-09, impersonation REFUSED). Called, not rendered (team/page.test.ts's form): the tree is
 * walked for the cards' elements and their props. Every owner-line read is a mock that records its call, so "no
 * reads" is a fact the test can see.
 */
const authState = vi.hoisted(() => ({
  userId: "user_ana" as string | null, appRole: null as string | null, actor: undefined as { sub: string } | undefined,
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({
    userId: authState.userId, actor: authState.actor,
    sessionClaims: authState.appRole ? { app_role: authState.appRole } : {},
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); },
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/preferences/person-prefs", () => ({ loadMyPreferences: async () => ({ language: null, theme: null }) }));
vi.mock("@/lib/branding/tenant-theme-reader", () => ({
  getTenantAccessState: async () => ({ status: "none" }),
  getTenantThemeInputs: async () => null,
  pickRequestThemeMode: () => ({ providerDefault: "light" }),
}));
vi.mock("@/components/preferences/preferences-panel", () => ({ PreferencesPanel: () => null }));
vi.mock("./owner-line-actions", () => ({
  startOwnerLineVerificationAction: vi.fn(), setOwnerLinePinAction: vi.fn(),
  removeOwnerLinePinAction: vi.fn(), removeOwnerLineCellAction: vi.fn(),
}));

type Mb = { accountId: string; userId: string; role: "owner" | "staff" | "technician"; businessName: string; number: string | null };
const reads = vi.hoisted(() => ({
  log: [] as string[],
  memberships: [] as Mb[],
  membershipsFail: false,
  enrollment: {} as Record<string, unknown>,
  failFor: null as string | null,
}));
vi.mock("@/lib/owner-line/memberships", () => ({
  listMyMemberships: async (_db: unknown, clerkUserId: string) => {
    reads.log.push(`memberships:${clerkUserId}`);
    if (reads.membershipsFail) throw new Error("listMyMemberships failed: boom");
    return reads.memberships;
  },
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => ({ tag: "service" }),
  readMyOwnerLineEnrollment: async (_db: unknown, accountId: string) => {
    reads.log.push(`enrollment:${accountId}`);
    if (reads.failFor === accountId) throw new Error("readMyOwnerLineEnrollment failed: permission denied");
    return reads.enrollment[accountId] ?? null;
  },
  readOwnerLineSwitch: async (_db: unknown, accountId: string) => {
    reads.log.push(`switch:${accountId}`);
    return { enabledAt: "2026-11-09T19:00:00Z", changedAt: "2026-11-09T19:00:00Z", changedByKind: "owner" };
  },
  readAccountTimezone: async (_db: unknown, accountId: string) => { reads.log.push(`zone:${accountId}`); return null; },
}));

const { default: PreferencesPage } = await import("./page");
const { OwnerLineCard } = await import("@/components/owner-line/owner-line-card");
const { OwnerLineCardError } = await import("@/components/owner-line/owner-line-card-error");

function all(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...all(el.props.children as ReactNode)];
}
const page = async (searchParams: { locale?: string } = {}) =>
  all(await PreferencesPage({ searchParams: Promise.resolve(searchParams) }));
const cardsIn = (els: ReactElement<Record<string, unknown>>[]) => els.filter((e) => e.type === OwnerLineCard);
const errorsIn = (els: ReactElement<Record<string, unknown>>[]) => els.filter((e) => e.type === OwnerLineCardError);

const ENROLLED = { id: "e1", e164: "+19565550142", verifiedAt: "2026-11-01T00:00:00Z", verifyExpiresAt: null,
  pinSetAt: "2026-11-01T00:00:00Z", lockedUntil: null };
const mb = (accountId: string, role: Mb["role"]): Mb =>
  ({ accountId, userId: `u-${accountId}`, role, businessName: `Biz ${accountId}`, number: "+19565550100" });

beforeEach(() => {
  authState.userId = "user_ana";
  authState.appRole = null;
  authState.actor = undefined;
  reads.log = [];
  reads.memberships = [];
  reads.membershipsFail = false;
  reads.enrollment = {};
  reads.failFor = null;
  delete process.env.BIS_I18N_QA;
});

describe("Mis preferencias: which memberships get an owner-line card (final review I-3)", () => {
  it("a demoted Technician who still holds an enrolment gets a stop-only card (survivor P13: `if (!offered) return null` -> FAILS)", async () => {
    reads.memberships = [mb("a1", "technician")];
    reads.enrollment = { a1: ENROLLED };
    const cards = cardsIn(await page());
    expect(cards).toHaveLength(1);
    expect(cards[0]!.props.accountId).toBe("a1");
    expect((cards[0]!.props.view as { step: string }).step).toBe("stopOnly");
  });

  it("a Technician with no enrolment gets no card at all", async () => {
    reads.memberships = [mb("a1", "technician")];
    const els = await page();
    expect(cardsIn(els)).toEqual([]);
    expect(els.find((e) => e.props.id === "owner-line")).toBeUndefined();
  });

  it("an Owner and a Staff member each get their own card", async () => {
    reads.memberships = [mb("a1", "owner"), mb("a2", "staff")];
    reads.enrollment = { a1: ENROLLED };
    const cards = cardsIn(await page());
    expect(cards.map((c) => c.props.accountId)).toEqual(["a1", "a2"]);
    expect(cards.map((c) => (c.props.view as { step: string }).step)).toEqual(["ready", "cell"]);
  });

  it("an agency viewer gets no cards and makes no owner-line read (survivor P14: `false ? []` -> FAILS)", async () => {
    authState.appRole = "agency_admin";
    reads.memberships = [mb("a1", "owner")];
    const els = await page();
    expect(cardsIn(els)).toEqual([]);
    expect(reads.log).toEqual([]);
  });
});

describe("Mis preferencias: impersonation is refused before any owner-line read (owner ruling 2026-11-09)", () => {
  it("a session carrying `actor` renders no owner-line section and reads nothing of it, not even the memberships (mutation: ignore actor -> FAILS)", async () => {
    authState.actor = { sub: "user_bis_staff" };
    reads.memberships = [mb("a1", "owner")];
    reads.enrollment = { a1: ENROLLED };
    const els = await page();
    expect(cardsIn(els)).toEqual([]);
    expect(errorsIn(els)).toEqual([]);
    expect(els.find((e) => e.props.id === "owner-line")).toBeUndefined();
    expect(reads.log).toEqual([]);
  });
});

describe("Mis preferencias: one card's failed read costs only that card (design Critical 1; final review M-1)", () => {
  it("a failed enrolment read for one business shows that card's error state, keeps the other card, logs it, and never throws (mutation: drop the per-card catch -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    reads.memberships = [mb("a1", "owner"), mb("a2", "staff")];
    reads.failFor = "a1";
    const els = await page();
    expect(cardsIn(els).map((c) => c.props.accountId)).toEqual(["a2"]);
    const errors = errorsIn(els);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.props).toMatchObject({ accountId: "a1", businessName: "Biz a1" });
    const lines = err.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("owner-line card read failed") && l.includes("a1")), lines.join("\n")).toBe(true);
    expect(lines.join("\n")).not.toContain("+1956");
    err.mockRestore();
  });

  it("a failed memberships read still renders the page, with one error state where the cards would be (mutation: let it throw -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    reads.membershipsFail = true;
    const els = await page();
    expect(cardsIn(els)).toEqual([]);
    expect(errorsIn(els)).toHaveLength(1);
    expect(err.mock.calls.map((c) => String(c[0])).some((l) => l.includes("owner-line memberships read failed"))).toBe(true);
    err.mockRestore();
  });
});

describe("Mis preferencias: the pseudo-locale reaches the cards (design Important 4)", () => {
  it("?locale=pseudo with the QA flag on renders the cards in pseudo (mutation: hard-code pseudo={false} -> FAILS)", async () => {
    process.env.BIS_I18N_QA = "1";
    reads.memberships = [mb("a1", "owner")];
    expect(cardsIn(await page({ locale: "pseudo" }))[0]!.props.pseudo).toBe(true);
  });
  it("without the flag, ?locale=pseudo changes nothing (control)", async () => {
    reads.memberships = [mb("a1", "owner")];
    expect(cardsIn(await page({ locale: "pseudo" }))[0]!.props.pseudo).toBe(false);
  });
  it("each card is told how long a call-in code works (OWNER_LINE_VERIFY_MINUTES)", async () => {
    const { OWNER_LINE_VERIFY_MINUTES } = await import("@bis/db");
    reads.memberships = [mb("a1", "owner")];
    expect(cardsIn(await page())[0]!.props.verifyMinutes).toBe(OWNER_LINE_VERIFY_MINUTES);
  });
});
