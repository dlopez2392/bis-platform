import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BillingCardView } from "@/lib/billing/billing-view";
import { BILLING_STATUS_TREATMENTS } from "@/lib/billing/billing-view";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const { BillingCard, BillingCardError, BillingCardSkeleton, PlanFields, dialogAfter, dialogOpened } = await import("./billing-card");

const here = path.dirname(fileURLToPath(import.meta.url));
const cardSource = readFileSync(path.join(here, "billing-card.tsx"), "utf8");

const ok = async () => ({ ok: true as const });
const base: BillingCardView = {
  status: "unbilled", plan: null, usage: [], since: null, nextInvoice: null, link: null,
  planOptions: [{ id: "p1", name: "Growth", price: "$149.00/month" }, { id: "p2", name: "Pro", price: "$299.00/month" }],
  defaultEmail: "owner@example.com",
  can: { send: true, changePlan: false, markComplimentary: true, stopComplimentary: false, copyLink: false },
  stripeReady: true,
};
type Actions = Pick<Parameters<typeof BillingCard>[0], "send" | "markComplimentary" | "stopComplimentary" | "changePlan">;
const props = (view: BillingCardView, actions: Partial<Actions> = {}) => ({
  view, send: ok, markComplimentary: ok, stopComplimentary: ok, changePlan: ok, ...actions,
});
const render = (view: BillingCardView) => renderToStaticMarkup(createElement(BillingCard, props(view)));
const active: BillingCardView = {
  ...base, status: "active", plan: { id: "p1", name: "Growth", price: "$149.00/month" },
  usage: [
    { meter: "voice_minutes", used: 312, included: 500, over: false, text: "312 of 500 minutes" },
    { meter: "sms", used: 12, included: 1000, over: false, text: "12 of 1,000 texts" },
    { meter: "ai_chats", used: 3, included: 200, over: false, text: "3 of 200 website chats" },
  ],
  since: "Since Oct 12", nextInvoice: "Next invoice Nov 12",
  can: { send: false, changePlan: true, markComplimentary: false, stopComplimentary: false, copyLink: false },
};
const complimentary: BillingCardView = {
  ...active, status: "complimentary", nextInvoice: null,
  can: { send: true, changePlan: true, markComplimentary: false, stopComplimentary: true, copyLink: false },
};

/** Every element in the tree the card RETURNS (called, not rendered: the
 *  card itself holds no React state, so its handlers can be reached and
 *  called without a DOM, which this repo's vitest has none of). */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((n) => elements(n as ReactNode));
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...elements(el.props.children as ReactNode)];
}
function byProp(tree: ReactNode, prop: string, value: unknown): ReactElement<Record<string, unknown>> {
  const hit = elements(tree).find((e) => e.props[prop] === value);
  if (!hit) throw new Error(`no element with ${prop}=${String(value)}`);
  return hit;
}
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
});

describe("BillingCard", () => {
  it("says the status as a dot AND a word, on the #billing anchor ⌘K jumps to (mutation: drop the word → FAILS; drop the id → the palette entry lands nowhere, FAILS)", () => {
    const html = render(active);
    expect(html).toContain('id="billing"');
    expect(html).toContain('data-status="active"');
    expect(renderedText(html)).toContain(BILLING_STATUS_TREATMENTS.active.label);
  });

  it("carries at most ONE primary button, and it is Send billing link (DESIGN rule 8): unbilled has it, active has none (mutation: render Change plan as the default variant → two primaries, FAILS)", () => {
    const primaries = (html: string) => html.match(/btn-primary/g)?.length ?? 0;
    expect(primaries(render(base))).toBe(1);
    expect(renderedText(render(base))).toContain(m["billing.send"]);
    expect(primaries(render(active))).toBe(0);
    expect(primaries(render(complimentary))).toBe(1);
  });

  it("shows plan, '312 of 500 minutes', the period it counts from, the chats note and the next invoice (G12) (mutation: drop the period label → the number has no context, rule 1, FAILS)", () => {
    const text = renderedText(render(active));
    for (const s of ["Growth", "$149.00/month", "312 of 500 minutes", "12 of 1,000 texts", "Since Oct 12", m["billing.usage.chatsNote"], "Next invoice Nov 12"]) {
      expect(text).toContain(s);
    }
  });

  it("the empty state sells the action; with no plans at all it says to create one first (DESIGN rule 5) (mutation: render the empty sentence when plans are missing → FAILS)", () => {
    expect(renderedText(render(base))).toContain(m["billing.card.empty"]);
    const noPlans = renderedText(render({ ...base, planOptions: [], can: { ...base.can, send: false, markComplimentary: false } }));
    expect(noPlans).toContain(m["billing.card.noPlans"]);
    expect(noPlans).not.toContain(m["billing.card.empty"]);
  });

  it("renders exactly the actions the view allows, and the link line + Copy link only while a link is out (mutation: always render Mark complimentary → FAILS)", () => {
    const linkView: BillingCardView = {
      ...base, status: "link_sent", link: { sentTo: "owner@example.com", expires: "Oct 16, 3:30 PM", url: "https://checkout.stripe.com/x" },
      can: { send: true, changePlan: false, markComplimentary: false, stopComplimentary: false, copyLink: true },
    };
    const text = renderedText(render(linkView));
    expect(text).toContain(m["billing.link.sentTo"].replace("{email}", "owner@example.com").replace("{date}", "Oct 16, 3:30 PM"));
    expect(text).toContain(m["billing.link.copy"]);
    expect(text).not.toContain(m["billing.comp.mark"]);
    const activeText = renderedText(render(active));
    expect(activeText).toContain(m["billing.changePlan"]);
    expect(activeText).not.toContain(m["billing.send"]);
    expect(activeText).not.toContain(m["billing.link.copy"]);
  });

  it("a complimentary account with a live link shows the link line and Copy link from the view, whatever its status word (G18) (mutation: gate the link line on status === 'link_sent' → FAILS)", () => {
    const text = renderedText(render({
      ...complimentary,
      link: { sentTo: "owner@example.com", expires: "Oct 16, 3:30 PM", url: "https://checkout.stripe.com/x" },
      can: { ...complimentary.can, copyLink: true },
    }));
    expect(text).toContain(m["billing.status.complimentary"]);
    expect(text).toContain(m["billing.link.sentTo"].replace("{email}", "owner@example.com").replace("{date}", "Oct 16, 3:30 PM"));
    expect(text).toContain(m["billing.link.copy"]);
  });

  it("with Stripe not connected it says so instead of promising a billing link it cannot send (mutation: drop the stripeReady line → the empty state names an action with no button, FAILS)", () => {
    const off = renderedText(render({ ...base, stripeReady: false, can: { ...base.can, send: false } }));
    expect(off).toContain(m["billing.card.noStripe"]);
    expect(off).not.toContain(m["billing.card.empty"]);
    expect(renderedText(render(base))).not.toContain(m["billing.card.noStripe"]);
  });

  it("the loading skeleton and the error card are the card's own shape on the SAME #billing anchor, so the banner's link and ⌘K land even before it loads or when it fails (rule 5, rule 7) (mutation: drop id=billing from the skeleton → FAILS)", () => {
    const skeleton = renderToStaticMarkup(createElement(BillingCardSkeleton));
    expect(skeleton).toContain('id="billing"');
    expect(skeleton).toContain('aria-busy="true"');
    expect(skeleton.match(/data-slot="skeleton"/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    const error = renderToStaticMarkup(createElement(BillingCardError));
    expect(error).toContain('id="billing"');
    expect(renderedText(error)).toContain(m["billing.card.error"]);
  });

  it("an address the Send action refuses lands ON the email field (aria-invalid, described by the message), never a toast; any other refusal is a toast and leaves the field clean (mutation: toast the email refusal → FAILS; drop aria-invalid → FAILS)", async () => {
    const refuseEmail = vi.fn(async () => ({ ok: false as const, error: m["billing.error.email"] }));
    const send = byProp(BillingCard(props(base, { send: refuseEmail })), "trigger", m["billing.send"]);
    const outcome = await (send.props.onSubmit as (f: FormData) => Promise<unknown>)(form({ planId: "p1", email: "a@b" }));
    expect(refuseEmail).toHaveBeenCalledOnce();
    expect(outcome).toEqual({ kind: "refused", error: m["billing.error.email"] });
    expect(toasts.error).not.toHaveBeenCalled();
    const state = dialogAfter(dialogOpened(() => "id-1"), outcome as Parameters<typeof dialogAfter>[1], () => "id-2");
    expect(state).toMatchObject({ open: true, emailError: m["billing.error.email"] });

    const html = renderToStaticMarkup(createElement(PlanFields, {
      plans: base.planOptions, defaultPlanId: "p1", email: "a@b", emailError: state.emailError, requestId: null, expectedPlanId: undefined,
    }));
    const input = html.match(/<input[^>]*name="email"[^>]*>/)?.[0] ?? "";
    expect(input).toContain('aria-invalid="true"');
    const describedBy = input.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeTruthy();
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(html).toMatch(new RegExp(`id="${esc(describedBy!)}"[^>]*>${esc(m["billing.error.email"])}<`));

    const refuseStripe = vi.fn(async () => ({ ok: false as const, error: m["billing.error.stripeFailed"] }));
    const send2 = byProp(BillingCard(props(base, { send: refuseStripe })), "trigger", m["billing.send"]);
    const outcome2 = await (send2.props.onSubmit as (f: FormData) => Promise<unknown>)(form({ planId: "p1", email: "a@b.co" }));
    expect(toasts.error).toHaveBeenCalledWith(m["billing.error.stripeFailed"]);
    expect(dialogAfter(state, outcome2 as Parameters<typeof dialogAfter>[1], () => "id-3").emailError).toBeNull();
    const clean = renderToStaticMarkup(createElement(PlanFields, {
      plans: base.planOptions, defaultPlanId: "p1", email: "a@b.co", emailError: null, requestId: null, expectedPlanId: undefined,
    }));
    const cleanInput = clean.match(/<input[^>]*name="email"[^>]*>/)?.[0];
    expect(cleanInput).toBeTruthy();
    expect(cleanInput).not.toContain('aria-invalid="');
    expect(renderedText(clean)).not.toContain(m["billing.error.email"]);
  });

  it("Change plan mints a NEW request id after a refused answer, so a retry in the same dialog is a new Stripe request (Stripe replays a saved 5xx under one key for 24 h, an assumption from its docs); a crash KEEPS it, because the change may have landed and the same key replays that answer; every opening mints its own (G15) (mutation: keep the id after a refusal → FAILS; re-mint after a crash → FAILS)", () => {
    let n = 0;
    const mint = () => `id-${++n}`;
    const opened = dialogOpened(mint);
    expect(opened).toEqual({ open: true, requestId: "id-1", emailError: null });
    const refused = dialogAfter(opened, { kind: "refused", error: m["billing.error.changePlanUnconfirmed"] }, mint);
    expect(refused).toMatchObject({ open: true, requestId: "id-2" });
    const crashed = dialogAfter(refused, { kind: "crashed" }, mint);
    expect(crashed).toMatchObject({ open: true, requestId: "id-2" });
    expect(dialogAfter(crashed, { kind: "ok" }, mint)).toMatchObject({ open: false });
    expect(dialogOpened(mint).requestId).toBe("id-3");

    // The form posts the id the state holds (not one minted at render).
    const html = renderToStaticMarkup(createElement(PlanFields, {
      plans: base.planOptions, defaultPlanId: "p2", email: undefined, emailError: null, requestId: "id-2", expectedPlanId: "p1",
    }));
    expect(html).toMatch(/<input[^>]*name="requestId"[^>]*value="id-2"/);
    expect(html).toMatch(/<input[^>]*name="expectedPlanId"[^>]*value="p1"/);
    // And the dialog moves its state through these two, not by hand.
    const dialogSource = cardSource.slice(cardSource.indexOf("function PlanDialog"));
    expect(dialogSource).toContain("dialogOpened(");
    expect(dialogSource).toContain("dialogAfter(");
  });

  it("the Change-plan refusal after a Stripe failure never promises 'Nothing was charged': the change may have gone through (mutation: map it back to billing.error.stripeFailed → FAILS)", () => {
    expect(m["billing.error.changePlanUnconfirmed"]).not.toMatch(/nothing was charged/i);
    expect(m["billing.error.changePlanUnconfirmed"]).toMatch(/check the plan/i);
  });

  it("complimentary changes run at once with an Undo that reverses them (rule 6): Mark → Stop, Stop → Mark the same plan, a complimentary Change plan → back to the old plan; a PAID Change plan has no Undo (G15) (mutation: drop Mark's undo → FAILS; swap the undo's planId and expectedPlanId → FAILS; give a paid change an undo → FAILS)", async () => {
    const undoOf = (i: number) => (toasts.success.mock.calls[i]![1] as { action: { label: string; onClick: () => void } }).action;

    const stop = vi.fn(ok);
    const mark = byProp(BillingCard(props(base, { stopComplimentary: stop })), "trigger", m["billing.comp.mark"]);
    await (mark.props.onSubmit as (f: FormData) => Promise<unknown>)(form({ planId: "p1" }));
    expect(toasts.success.mock.calls[0]![0]).toBe(m["billing.comp.done"]);
    expect(undoOf(0).label).toBe(m["common.undo"]);
    undoOf(0).onClick();
    await flush();
    expect(stop).toHaveBeenCalledOnce();

    const remark = vi.fn<(f: FormData) => Promise<{ ok: true }>>(async () => ({ ok: true as const }));
    const stopButton = byProp(BillingCard(props(complimentary, { markComplimentary: remark })), "children", m["billing.comp.stop"]);
    (stopButton.props.onClick as () => void)();
    await flush();
    expect(toasts.success.mock.calls.at(-1)![0]).toBe(m["billing.comp.stopped"]);
    undoOf(toasts.success.mock.calls.length - 1).onClick();
    await flush();
    expect(remark.mock.calls[0]![0].get("planId")).toBe("p1");

    const change = vi.fn<(f: FormData) => Promise<{ ok: true }>>(async () => ({ ok: true as const }));
    const compChange = byProp(BillingCard(props(complimentary, { changePlan: change })), "trigger", m["billing.changePlan"]);
    await (compChange.props.onSubmit as (f: FormData) => Promise<unknown>)(form({ planId: "p2", expectedPlanId: "p1", requestId: "r1" }));
    undoOf(toasts.success.mock.calls.length - 1).onClick();
    await flush();
    const back = change.mock.calls[1]![0];
    expect([back.get("planId"), back.get("expectedPlanId")]).toEqual(["p1", "p2"]);
    expect(back.get("requestId")).not.toBe("r1");

    toasts.success.mockReset();
    const paidChange = byProp(BillingCard(props(active)), "trigger", m["billing.changePlan"]);
    await (paidChange.props.onSubmit as (f: FormData) => Promise<unknown>)(form({ planId: "p2", expectedPlanId: "p1", requestId: "r2" }));
    expect(toasts.success).toHaveBeenCalledWith(m["billing.changePlan.done"], undefined);
  });
});
