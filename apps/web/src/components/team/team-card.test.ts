import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TeamMember } from "@bis/db";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { UNDO_WINDOW_MS, type PendingInvite } from "@/lib/team/team-view";

/**
 * The Team card (staff and roles, spec §8). Rendered with
 * `renderToStaticMarkup` + `createElement`, the house form for a client
 * component with hooks (calendar/bookings-list.test.ts's own comment). The
 * card's handlers are plain async functions (team-handlers.ts), so each
 * toast, its Undo and its window are reached here without a DOM.
 *
 * Copy is asserted on `renderedText(html)`, never raw markup, because React
 * escapes an apostrophe and a negative assertion on one can never fail.
 */

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const { TeamCard, TeamSkeleton, RoleHelp } = await import("./team-card");
const { inviteMember, changeRole, changeLanguage, removeMember, revokeInvite, TEAM_TOAST_MS } = await import("./team-handlers");
const { teamErrorCopy, roomCopy, emptyCopy, fill } = await import("./team-copy");

const here = path.dirname(fileURLToPath(import.meta.url));
const ACTIONS_SRC = readFileSync(
  path.resolve(here, "../../app/(dashboard)/dashboard/accounts/[accountId]/team/actions.ts"), "utf8",
);

const OWNER: TeamMember = { userId: "11111111-1111-4111-8111-111111111111", clerkUserId: "user_1", email: "rosa@rio.test", name: "Rosa Rio", role: "owner", language: null };
const STAFF: TeamMember = { userId: "22222222-2222-4222-8222-222222222222", clerkUserId: "user_2", email: "tom@rio.test", name: null, role: "staff", language: "es" };
const INVITE: PendingInvite = { id: "orginv_1", email: "new@rio.test", role: "staff", language: "es" };

const ok = async () => ({ ok: true as const });
const actions = () => ({
  invite: vi.fn(ok), setRole: vi.fn(ok), setLanguage: vi.fn(ok), remove: vi.fn(ok),
  undoRemove: vi.fn(ok), revoke: vi.fn(ok), undoRevoke: vi.fn(ok),
});

type CardProps = Parameters<typeof TeamCard>[0];
const card = (over: Partial<CardProps> = {}) => renderToStaticMarkup(createElement(TeamCard, {
  members: [OWNER, STAFF], pending: [INVITE], room: 3, clerkUnavailable: false,
  defaultLanguage: "en", viewer: "owner", actions: actions(), ...over,
}));
const buttons = (html: string) => html.match(/<button[^>]*>/g) ?? [];
const primaries = (html: string) => buttons(html).filter((b) => b.includes("btn-primary"));
/** The DotPill carrying `status`: its dot, then its word, and nothing else. */
const pill = (status: string, word: string) =>
  new RegExp(`data-status="${status}"[^>]*><span[^>]*aria-hidden="true"></span>${word}</span>`);

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
});

describe("TeamCard: rows", () => {
  it("shows each member's role as a dot AND a word (rule 3) (mutation: drop the word -> FAILS)", () => {
    const html = card();
    expect(html).toMatch(pill("owner", m["team.role.owner"]));
    expect(html).toMatch(pill("staff", m["team.role.staff"]));
  });

  it("shows Active for a member and Invited for a pending invitation, each a dot AND a word (mutation: drop the status pill -> FAILS)", () => {
    const html = card();
    expect(html).toMatch(pill("active", m["team.status.active"]));
    expect(html).toMatch(pill("invited", m["team.status.invited"]));
  });

  it("names a member by name, or by email when there is none, and lists every email (mutation: show the name only -> FAILS)", () => {
    const text = renderedText(card());
    expect(text).toContain("Rosa Rio");
    expect(text).toContain("rosa@rio.test");
    expect(text).toContain("tom@rio.test");
    expect(text).toContain("new@rio.test");
  });

  it("says each person's language as a word, a person with none following the company's (mutation: show the code -> FAILS)", () => {
    const text = renderedText(card({ members: [OWNER], pending: [], defaultLanguage: "es" }));
    expect(text).toContain(m["team.languageName.spanish"]);
    expect(text).not.toContain(m["team.languageName.english"]);
  });

  it("tells the Owner the honest limit: Staff see every contact, exporting and deleting is Owner-only (mutation: drop the help text -> FAILS)", () => {
    expect(renderedText(card())).toContain(m["team.ownerHelp"]);
  });

  it("carries the palette anchor id=\"team\" on the card and on its skeleton (mutation: drop either id -> FAILS)", () => {
    expect(card()).toMatch(/^<div[^>]*id="team"/);
    expect(renderToStaticMarkup(createElement(TeamSkeleton))).toMatch(/^<div[^>]*id="team"/);
  });
});

describe("TeamCard: one primary (rule 8)", () => {
  it("has exactly ONE primary button, with members, an invitation and room (mutation: make Remove primary -> FAILS)", () => {
    expect(primaries(card())).toHaveLength(1);
  });
  it("that one primary is the invite (mutation: make Remove primary and the invite ghost -> FAILS)", () => {
    expect(card()).toMatch(new RegExp(`btn-primary[^>]*>(?:<svg[\\s\\S]*?</svg>)?${m["team.invite"]}</button>`));
  });
});

describe("TeamCard: states (rule 5)", () => {
  it("an Owner alone reads the empty sentence (mutation: drop the empty state -> FAILS)", () => {
    expect(renderedText(card({ members: [OWNER], pending: [] }))).toContain(m["team.empty"]);
  });
  it("a team with a second person does not (mutation: show it always -> FAILS)", () => {
    expect(renderedText(card({ members: [OWNER, STAFF], pending: [] }))).not.toContain(m["team.empty"]);
    expect(renderedText(card({ members: [OWNER], pending: [INVITE] }))).not.toContain(m["team.empty"]);
  });
  it("the agency, which is never on the list, reads its own empty sentence, never \"Just you\" (mutation: one sentence for both -> FAILS)", () => {
    const text = renderedText(card({ members: [], pending: [], viewer: "agency" }));
    expect(text).toContain(m["team.empty.agency"]);
    expect(text).not.toContain(m["team.empty"]);
    expect(renderedText(card({ members: [OWNER], pending: [], viewer: "agency" }))).not.toContain(m["team.empty"]);
  });

  it("a full team says so and disables the invite (mutation: leave the invite enabled -> FAILS)", () => {
    const html = card({ room: 0 });
    expect(renderedText(html)).toContain(m["team.full"]);
    const invite = primaries(html);
    expect(invite).toHaveLength(1);
    expect(invite[0]).toContain('disabled=""');
  });
  it("with room, the invite is enabled and the room is said in words", () => {
    const html = card({ room: 3 });
    expect(primaries(html)[0]).not.toContain('disabled=""');
    expect(renderedText(html)).toContain("Room for 3 more people");
    expect(renderedText(card({ room: 1 }))).toContain("Room for 1 more person");
  });
  it("no known cap says nothing about room (mutation: treat null as 0 -> FAILS)", () => {
    const text = renderedText(card({ room: null }));
    expect(text).not.toContain("Room for");
    expect(text).not.toContain(m["team.full"]);
  });

  it("Clerk unreachable: the note AND the stored rows (mutation: hide the rows when Clerk is down -> FAILS)", () => {
    const text = renderedText(card({ clerkUnavailable: true, pending: [] }));
    expect(text).toContain(m["team.clerkUnavailable"]);
    expect(text).toContain("rosa@rio.test");
    expect(text).toContain("tom@rio.test");
  });
  it("Clerk unreachable: no \"Just you so far\", because the invitations are unknown, not none (mutation: show the empty sentence anyway -> FAILS)", () => {
    const text = renderedText(card({ members: [OWNER], pending: [], clerkUnavailable: true }));
    expect(text).toContain(m["team.clerkUnavailable"]);
    expect(text).not.toContain(m["team.empty"]);
    expect(renderedText(card({ members: [], pending: [], clerkUnavailable: true, viewer: "agency" }))).not.toContain(m["team.empty.agency"]);
  });
  it("Clerk reachable: no such note", () => {
    expect(renderedText(card())).not.toContain(m["team.clerkUnavailable"]);
  });

  it("the skeleton is rows, never a spinner (rule 7)", () => {
    const html = renderToStaticMarkup(createElement(TeamSkeleton));
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toMatch(/spin/);
    expect(html.match(/data-slot="skeleton"/g)!.length).toBeGreaterThanOrEqual(6);
  });
});

/**
 * Fix round 1, I1. React 19 resets a form after EVERY `action` resolves,
 * a refusal included, and Radix Select reverts on that reset event
 * (lib/forms/use-form-submit.ts). A refused invite therefore wiped the
 * typed email and put role and language back to their defaults while the
 * dialog stayed open. The house fix is onSubmit through useFormSubmit, no
 * `action` prop. No DOM here, so the shape is pinned from source.
 */
describe("the invite form keeps what was typed when an invite is refused", () => {
  const CARD_SRC = readFileSync(path.join(here, "team-card.tsx"), "utf8");
  const form = CARD_SRC.slice(CARD_SRC.indexOf("function InviteDialog("));
  it("submits through useFormSubmit with no action= prop (mutation: restore <form action={...}> -> FAILS)", () => {
    expect(form.length).toBeLessThan(CARD_SRC.length);
    expect(CARD_SRC).toContain('import { useFormSubmit } from "@/lib/forms/use-form-submit";');
    expect(form).toContain("useFormSubmit(");
    expect(form).toMatch(/<form\s+onSubmit=\{onSubmit\}/);
    // No `action=` anywhere on the form element, however it is formatted.
    const formTag = form.slice(form.indexOf("<form"), form.indexOf(">", form.indexOf("<form")) + 1);
    expect(formTag).toContain("onSubmit");
    expect(formTag).not.toMatch(/\baction=/);
  });
  it("the send button takes pending by hand, since useFormStatus reports only for action forms (mutation: read useFormStatus again -> FAILS)", () => {
    expect(CARD_SRC).not.toContain("useFormStatus(");
    expect(CARD_SRC).not.toMatch(/import {[^}]*useFormStatus/);
    expect(form).toContain("<SendButton pending={pending} locale={locale} />");
  });
});

describe("the inline Selects show on a hovered row (fix round 1, M7)", () => {
  const CARD_SRC = readFileSync(path.join(here, "team-card.tsx"), "utf8");
  const trigger = CARD_SRC.match(/const INLINE_TRIGGER = "([^"]*)"/)?.[1] ?? "";
  const row = CARD_SRC.match(/const LAYOUT = "([^"]*)"/)?.[1] ?? "";
  it("a hovered trigger rises to the input step (--surface-2) with the interactive edge, never the row's own --surface-3 (mutation: hover:bg-[var(--surface-3)] on the trigger -> FAILS)", () => {
    expect(row).toContain("hover:bg-[var(--surface-3)]");
    expect(trigger).toContain("hover:bg-[var(--surface-2)]");
    expect(trigger).toContain("dark:hover:bg-[var(--surface-2)]");
    expect(trigger).toContain("hover:border-[var(--line-strong)]");
    expect(trigger).not.toContain("hover:bg-[var(--surface-3)]");
  });
});

/**
 * Phone-width overflow fix (CI's own `phone-width.spec.ts:447`, "a
 * representative subset holds at the narrower 320px too" — the Team
 * card's header action, "Invite someone" in `CardAction`, was the widest
 * offender at 320px: `grid-cols-[1fr_auto]` gave its column the button's
 * own intrinsic (`auto`) width unconditionally, which this card's title
 * column could not shrink below). The fix lives in the shared
 * `ui/card.tsx` primitive (both CardHeader and CardAction render on this
 * same card, plus billing's), so it is pinned from THAT file's source,
 * not team-card.tsx's own — no DOM layout engine runs under jsdom, so a
 * computed-width assertion cannot exist here; a real measurement is
 * `phone-width.spec.ts`'s job (CI only, per this task's own brief).
 */
describe("the Card header's action drops below the title at phone width, not beside it (ui/card.tsx)", () => {
  const CARD_UI_SRC = readFileSync(path.resolve(here, "../ui/card.tsx"), "utf8");
  const header = CARD_UI_SRC.match(/function CardHeader[\s\S]*?className=\{cn\([\s\S]*?"([^"]*)"/)?.[1] ?? "";
  const action = CARD_UI_SRC.match(/function CardAction[\s\S]*?className=\{cn\([\s\S]*?"([^"]*)"/)?.[1] ?? "";

  it("reads real strings from ui/card.tsx (the checks below are vacuous otherwise)", () => {
    expect(header.length).toBeGreaterThan(10);
    expect(action.length).toBeGreaterThan(5);
  });

  it("the title/action 2-column split applies only from sm up, so a narrow header stays one column and the action falls to its own row (mutation: drop the sm: gate -> FAILS)", () => {
    expect(header).toContain("sm:has-data-[slot=card-action]:grid-cols-[1fr_auto]");
  });

  it("the action's own column/row placement is gated the same way, so it is not forced into a cramped auto column below sm (mutation: make col-start-2/row-start-1 unconditional again -> FAILS)", () => {
    expect(action).toContain("sm:col-start-2");
    expect(action).toContain("sm:row-span-2");
    expect(action).toContain("sm:row-start-1");
    expect(action).not.toMatch(/(?<!sm:)col-start-2/);
    expect(action).not.toMatch(/(?<!sm:)row-start-1/);
  });
});

describe("the error codes the Team actions return all have copy", () => {
  const union = ACTIONS_SRC.match(/export type TeamError =([\s\S]*?);/)?.[1] ?? "";
  const codes = [...union.matchAll(/"(team\.[A-Za-z.]+)"/g)].map((x) => x[1]!);

  it("reads the codes from actions.ts itself (the loop below is vacuous otherwise)", () => {
    expect(codes.length).toBeGreaterThanOrEqual(13);
    expect(codes).toContain("team.undo.expired");
    expect(codes).toContain("team.lastOwner");
  });
  it.each(["owner", "agency"] as const)("every code is a sentence for the %s, with a Spanish twin (mutation: delete any code's message or .es -> FAILS)", (viewer) => {
    const all = m as Record<string, string>;
    for (const code of codes) {
      const copy = teamErrorCopy(code as Parameters<typeof teamErrorCopy>[0], viewer);
      expect(copy, code).toBeTruthy();
      expect(copy, code).not.toBe(code);
      expect(all[`${code}.es`], `${code}.es`).toBeTruthy();
    }
  });
  it("a full team tells the agency to raise the limit, not to ask BIS (mutation: one sentence for both -> FAILS)", () => {
    expect(teamErrorCopy("team.full", "owner")).toBe(m["team.full"]);
    expect(teamErrorCopy("team.full", "agency")).toBe(m["team.full.agency"]);
  });
  it("every team.* message has a Spanish twin (mutation: delete any .es -> FAILS)", () => {
    const keys = Object.keys(m).filter((k) => k.startsWith("team.") && !k.endsWith(".es"));
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) expect((m as Record<string, string>)[`${k}.es`], `${k}.es`).toBeTruthy();
  });
  it("roomCopy: plural, singular, full, unknown", () => {
    expect(roomCopy(4, "owner")).toBe("Room for 4 more people");
    expect(roomCopy(1, "owner")).toBe("Room for 1 more person");
    expect(roomCopy(0, "owner")).toBe(m["team.full"]);
    expect(roomCopy(0, "agency")).toBe(m["team.full.agency"]);
    expect(roomCopy(null, "owner")).toBeNull();
  });
});

describe("handlers: applied at once, with an Undo (rule 6)", () => {
  const undoOf = () => {
    const opts = toasts.success.mock.calls[0]![1] as { action: { label: string; onClick: () => void }; duration: number };
    expect(opts.action.label).toBe(m["common.undo"]);
    return opts;
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("remove: runs at once, then Undo re-adds that same person (mutation: drop the undo -> FAILS)", async () => {
    const a = actions();
    a.remove.mockResolvedValue({ ok: true, undo: { userId: STAFF.userId } } as never);
    await removeMember(a, STAFF, "owner");
    expect(a.remove).toHaveBeenCalledWith(STAFF.userId);
    expect(toasts.success.mock.calls[0]![0]).toBe(m["team.removed"].replace("{name}", "tom@rio.test"));
    undoOf().action.onClick();
    await flush();
    expect(a.undoRemove).toHaveBeenCalledWith(STAFF.userId);
  });

  it("remove: the Undo toast closes well inside the server's two-minute window (mutation: duration Infinity -> FAILS)", async () => {
    const a = actions();
    a.remove.mockResolvedValue({ ok: true, undo: { userId: STAFF.userId } } as never);
    await removeMember(a, STAFF, "owner");
    expect(TEAM_TOAST_MS).toBeLessThan(UNDO_WINDOW_MS);
    expect(undoOf().duration).toBe(TEAM_TOAST_MS);
  });

  it("remove: an Undo pressed past the window is refused here, with the expired sentence, and never calls the server (mutation: drop the client window check -> FAILS)", async () => {
    const a = actions();
    a.remove.mockResolvedValue({ ok: true, undo: { userId: STAFF.userId } } as never);
    let t = 1_000_000;
    await removeMember(a, STAFF, "owner", () => t);
    t += UNDO_WINDOW_MS + 1;
    undoOf().action.onClick();
    await flush();
    expect(a.undoRemove).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith(m["team.undo.expired"]);
  });

  it("remove: the server saying the undo expired is said in words (mutation: show the code -> FAILS)", async () => {
    const a = actions();
    a.remove.mockResolvedValue({ ok: true, undo: { userId: STAFF.userId } } as never);
    a.undoRemove.mockResolvedValue({ ok: false, error: "team.undo.expired" } as never);
    await removeMember(a, STAFF, "owner");
    undoOf().action.onClick();
    await flush();
    expect(toasts.error).toHaveBeenCalledWith(m["team.undo.expired"]);
  });

  it("remove: no undo handle (the removal was not recorded) means no Undo button, never a dead one", async () => {
    const a = actions();
    await removeMember(a, STAFF, "owner");
    expect(toasts.success).toHaveBeenCalledOnce();
    expect(toasts.success.mock.calls[0]![1]).toBeUndefined();
  });

  it("remove: the last Owner is refused in words (mutation: toast success regardless -> FAILS)", async () => {
    const a = actions();
    a.remove.mockResolvedValue({ ok: false, error: "team.lastOwner" } as never);
    await removeMember(a, OWNER, "owner");
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith(m["team.lastOwner"]);
  });

  it("an action that throws says the page may be out of date (mutation: let it throw -> FAILS)", async () => {
    const a = actions();
    a.remove.mockRejectedValue(new Error("boom"));
    await removeMember(a, STAFF, "owner");
    expect(toasts.error).toHaveBeenCalledWith(m["common.actionCrashed"]);
  });

  // Review fix round (minor): a Team handler's own toast AND its Undo
  // label, in Spanish — every handler reads locale through to both
  // t(m, "team.removed", locale) and t(m, "common.undo", locale), not just
  // the catalogue string's own grammar (which "the Spanish role-change
  // toast" block below already covers).
  it("remove: the toast and its Undo label both read in Spanish when locale is es (mutation: drop the locale param from either read -> FAILS)", async () => {
    const a = actions();
    a.remove.mockResolvedValue({ ok: true, undo: { userId: STAFF.userId } } as never);
    await removeMember(a, STAFF, "owner", undefined, "es");
    expect(toasts.success.mock.calls[0]![0]).toBe(m["team.removed.es"].replace("{name}", "tom@rio.test"));
    const opts = toasts.success.mock.calls[0]![1] as { action: { label: string; onClick: () => void } };
    expect(opts.action.label).toBe(m["common.undo.es"]);
  });

  it("role: saved at once, Undo puts back the PREVIOUS role (mutation: undo with the new role -> FAILS)", async () => {
    const a = actions();
    a.setRole.mockResolvedValue({ ok: true, previous: "staff" } as never);
    await changeRole(a, STAFF, "owner", "owner");
    expect(a.setRole).toHaveBeenCalledWith(STAFF.userId, "owner");
    expect(toasts.success.mock.calls[0]![0]).toBe(
      m["team.role.changed"].replace("{name}", "tom@rio.test").replace("{role}", m["team.role.owner"]),
    );
    undoOf().action.onClick();
    await flush();
    expect(a.setRole).toHaveBeenLastCalledWith(STAFF.userId, "staff");
  });

  it("role: a failure is said in words and offers no Undo", async () => {
    const a = actions();
    a.setRole.mockResolvedValue({ ok: false, error: "team.role.failed" } as never);
    await changeRole(a, STAFF, "owner", "owner");
    expect(toasts.error).toHaveBeenCalledWith(m["team.role.failed"]);
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("language: Undo puts back the previous value, null included (mutation: undo to the default instead -> FAILS)", async () => {
    const a = actions();
    a.setLanguage.mockResolvedValue({ ok: true, previous: null } as never);
    await changeLanguage(a, OWNER, "es", "owner");
    expect(a.setLanguage).toHaveBeenCalledWith(OWNER.userId, "es");
    undoOf().action.onClick();
    await flush();
    expect(a.setLanguage).toHaveBeenLastCalledWith(OWNER.userId, null);
  });

  it("revoke: runs at once, Undo re-invites with the same email, role and language, and says a new email goes out (mutation: re-invite as staff/en -> FAILS)", async () => {
    const a = actions();
    const owner = { ...INVITE, role: "owner" as const };
    a.revoke.mockResolvedValue({ ok: true, undo: { email: owner.email, role: "owner", language: "es" } } as never);
    await revokeInvite(a, owner, "owner");
    expect(a.revoke).toHaveBeenCalledWith(owner.id);
    undoOf().action.onClick();
    await flush();
    expect(a.undoRevoke).toHaveBeenCalledWith(owner.email, "owner", "es");
    expect(toasts.success.mock.calls[1]![0]).toBe(m["team.undone.revoke"].replace("{email}", owner.email));
  });

  it("invite: success closes with a toast; a refusal comes back as the dialog's sentence and keeps it open (spec §9) (mutation: toast the refusal and close -> FAILS)", async () => {
    const a = actions();
    const f = new FormData();
    f.set("email", "pat@rio.test");
    expect(await inviteMember(a, f, "owner")).toBeNull();
    expect(a.invite).toHaveBeenCalledWith(f);
    expect(toasts.success).toHaveBeenCalledWith(m["team.invite.sent"].replace("{email}", "pat@rio.test"));
    a.invite.mockResolvedValue({ ok: false, error: "team.invite.alreadyMember" } as never);
    expect(await inviteMember(a, f, "owner")).toBe(m["team.invite.alreadyMember"]);
    expect(toasts.error).not.toHaveBeenCalled();
  });
});

describe("the Spanish role-change toast (review M4)", () => {
  const es = (m as Record<string, string>)["team.role.changed.es"]!;
  it("puts the role after a colon, never as a predicate, so 'Dueño' needs no gender agreement and is no mid-sentence capital (mutation: '{name} ahora es {role}.' -> FAILS)", () => {
    expect(es).toMatch(/: \{role\}\.$/);
    expect(es).not.toMatch(/\bes \{role\}/);
    const filled = es.replace("{name}", "María").replace("{role}", (m as Record<string, string>)["team.role.owner.es"]!);
    expect(filled).not.toContain("María ahora es Dueño");
  });
});

/**
 * F-085 part 1 (spec §9): the role picker adds Technician, with the help line
 * "Sees only the customers you assign to them." Radix renders a closed
 * Select's options (and a closed Dialog's content) to nothing on the server,
 * so the option lists are pinned from source and the help line through its
 * own component, which both the invite form and a member's row render.
 */
describe("Technician on the Team card", () => {
  const CARD_SRC = readFileSync(path.join(here, "team-card.tsx"), "utf8");
  const TECH: TeamMember = { userId: "33333333-3333-4333-8333-333333333333", clerkUserId: "user_3", email: "ana@rio.test", name: "Ana", role: "technician", language: null };
  const invite = CARD_SRC.slice(CARD_SRC.indexOf("function InviteDialog("));
  const memberRow = CARD_SRC.slice(CARD_SRC.indexOf("function MemberRow("), CARD_SRC.indexOf("function InviteRow("));

  it("a Technician's role is a dot AND the word (rule 3) (mutation: drop rolePills.technician -> FAILS)", () => {
    expect(card({ members: [OWNER, TECH] })).toMatch(pill("technician", m["team.role.technician"]));
  });

  it("the invite's role select and each member's role select list technician by its word (mutation: leave either list at two roles -> FAILS)", () => {
    expect(memberRow.length).toBeGreaterThan(0);
    expect(invite.length).toBeLessThan(CARD_SRC.length);
    expect(memberRow).toContain('(["owner", "staff", "technician"] as const).map((r) => <SelectItem key={r} value={r}>{rolePills[r].label}</SelectItem>)');
    expect(invite).toContain('(["staff", "technician", "owner"] as const).map((r) => <SelectItem key={r} value={r}>{rolePills[r].label}</SelectItem>)');
    expect(m["team.role.technician"]).toBe("Technician");
  });

  it("RoleHelp says what a Technician sees, and nothing for the other roles (mutation: render it for every role -> FAILS)", () => {
    expect(renderedText(renderToStaticMarkup(createElement(RoleHelp, { role: "technician" }))).trim()).toBe(m["team.roleHelp.technician"]);
    expect(renderToStaticMarkup(createElement(RoleHelp, { role: "staff" }))).toBe("");
    expect(renderToStaticMarkup(createElement(RoleHelp, { role: "owner" }))).toBe("");
  });

  it("choosing Technician in the invite shows the help line: the role is held in state and RoleHelp reads it (mutation: render RoleHelp for the default role only -> FAILS)", () => {
    expect(invite).toMatch(/<Select name="role" value=\{role\} onValueChange=\{\(v\) => \{ if \(isAccountRole\(v\)\) setRole\(v\); \}\}>/);
    expect(invite).toContain("<RoleHelp role={role} locale={locale} />");
  });

  it("a member who is a Technician carries the help line on their row; a team without one does not (mutation: drop RoleHelp from the row -> FAILS)", () => {
    expect(renderedText(card({ members: [OWNER, TECH] }))).toContain(m["team.roleHelp.technician"]);
    expect(renderedText(card({ members: [OWNER, STAFF] }))).not.toContain(m["team.roleHelp.technician"]);
  });

  it("the help line has a Spanish twin", () => {
    expect(m["team.role.technician.es"]).toBe("Técnico");
    expect(m["team.roleHelp.technician.es"]).toBe("Solo ve los clientes que usted le asigne.");
  });
});

// S-10 T6: every team.* key already carried a Spanish twin (spec row 16: "0
// missing .es"), but the card read every one of them with a bare m[...],
// English regardless of the reader's own stored choice. TeamCard,
// MemberRow, InviteRow, InviteDialog, TeamSkeleton, TeamAccessOff and
// TeamLoadError now take an optional `locale` prop (default "en", so every
// existing `card()` call above — none of which passes one — is unaffected)
// and read every string through t()/fill(t(...)).
describe("TeamCard: Spanish (S-10 T6)", () => {
  it("the card's own title, body and help line read in Spanish (mutation: hard-code m[key] → FAILS)", () => {
    const text = renderedText(card({ locale: "es" }));
    expect(text).toContain(m["team.title.es"]);
    expect(text).toContain(m["team.body.es"]);
    expect(text).toContain(m["team.ownerHelp.es"]);
    expect(text).not.toContain(m["team.title"]);
  });

  // Review fix round (I-3): team.body is read on the client Owner's OWN
  // Team page, not only on the agency's Settings card describing someone
  // else's company — "empresa" is the glossary's word for the agency's OWN
  // account label, never for addressing the Owner about their own business
  // (DESIGN.md §4.3: "empresa (the agency's word for an account)").
  it("team.body.es never says 'empresa' (mutation: restore '...de esta empresa.' → FAILS)", () => {
    expect(m["team.body.es"]).not.toMatch(/\bempresa\b/i);
    expect(m["team.body.es"]).toBe("Las personas que pueden entrar a esta cuenta.");
  });

  it("a member's role and status pills, and their language, read in Spanish (mutation: keep rolePills/languageNames English → FAILS)", () => {
    const html = card({ locale: "es", members: [OWNER, STAFF], pending: [] });
    expect(html).toMatch(pill("owner", m["team.role.owner.es"]));
    expect(html).toMatch(pill("active", m["team.status.active.es"]));
    expect(renderedText(html)).toContain(m["team.languageName.spanish.es"]);
  });

  it("a pending invitation's role, status and language read in Spanish (mutation: keep InviteRow's pills English → FAILS)", () => {
    const html = card({ locale: "es", members: [], pending: [INVITE] });
    expect(html).toMatch(pill("staff", m["team.role.staff.es"]));
    expect(html).toMatch(pill("invited", m["team.status.invited.es"]));
    expect(renderedText(html)).toContain(m["team.languageName.spanish.es"]);
  });

  // Radix renders a CLOSED Dialog's content to nothing on the server (the
  // suite's own "invite" source slice above exists for exactly this reason),
  // so the dialog's own words are pinned from source, not from a render.
  it("the invite dialog's title, body, field labels and send button read through t(), not a bare m[...] (mutation: leave InviteDialog's own m[] reads → FAILS)", () => {
    const FULL_SRC = readFileSync(path.join(here, "team-card.tsx"), "utf8");
    const src = FULL_SRC.slice(FULL_SRC.indexOf("function InviteDialog("), FULL_SRC.indexOf("function TeamSkeleton("));
    for (const key of ["team.invite", "team.invite.title", "team.invite.body", "team.invite.email", "team.invite.role", "team.invite.language"]) {
      expect(src, key).toContain(`t(m, "${key}", locale)`);
      expect(src, key).not.toContain(`m["${key}"]`);
    }
  });

  it("the room line and the empty sentence read in Spanish (mutation: call roomCopy/emptyCopy with no locale → FAILS)", () => {
    expect(renderedText(card({ locale: "es", room: 3 }))).toContain("3 personas más");
    expect(renderedText(card({ locale: "es", room: 1 }))).toContain(m["team.room.one.es"]);
    expect(renderedText(card({ locale: "es", members: [OWNER], pending: [] }))).toContain(m["team.empty.es"]);
  });

  it("RoleHelp and the skeleton read in Spanish (mutation: leave either in English → FAILS)", () => {
    expect(renderedText(renderToStaticMarkup(createElement(RoleHelp, { role: "technician", locale: "es" }))).trim()).toBe(m["team.roleHelp.technician.es"]);
    expect(renderedText(renderToStaticMarkup(createElement(TeamSkeleton, { locale: "es" })))).toContain(m["team.title.es"]);
  });
});

describe("TeamAccessOff and TeamLoadError: Spanish (S-10 T6)", () => {
  it("TeamAccessOff reads its note in Spanish (mutation: hard-code m[key] → FAILS)", async () => {
    const { TeamAccessOff } = await import("./team-card");
    const html = renderToStaticMarkup(createElement(TeamAccessOff, { locale: "es" }));
    expect(renderedText(html)).toContain(m["team.accessOffNote.es"]);
  });

  it("TeamLoadError reads its note in Spanish (mutation: hard-code m[key] → FAILS)", async () => {
    const { TeamLoadError } = await import("./team-card");
    const html = renderToStaticMarkup(createElement(TeamLoadError, { locale: "es" }));
    expect(renderedText(html)).toContain(m["team.loadFailed.es"]);
  });
});

describe("team-copy: functions of locale (S-10 T6)", () => {
  it("roomCopy and emptyCopy read in Spanish, with the correct plural form (mutation: skip locale in the plural branch → FAILS)", () => {
    expect(roomCopy(4, "owner", "es")).toBe(fill(m["team.room.many.es"], { count: 4 }));
    expect(roomCopy(1, "owner", "es")).toBe(m["team.room.one.es"]);
    expect(roomCopy(0, "owner", "es")).toBe(m["team.full.es"]);
    expect(roomCopy(0, "agency", "es")).toBe(m["team.full.agency.es"]);
    expect(emptyCopy("owner", 1, 0, false, "es")).toBe(m["team.empty.es"]);
    expect(emptyCopy("agency", 0, 0, false, "es")).toBe(m["team.empty.agency.es"]);
  });

  it("teamErrorCopy reads every code in Spanish (mutation: drop the locale param → FAILS)", () => {
    expect(teamErrorCopy("team.lastOwner", "owner", "es")).toBe(m["team.lastOwner.es"]);
    expect(teamErrorCopy("team.full", "agency", "es")).toBe(m["team.full.agency.es"]);
  });
});
