import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
// A default successful Lift pause: a fixed liftedAt/pausedAt pair so any
// test not specifically about Lift pause's Undo gets a stable, inspectable
// answer rather than a real Date.now() value.
const okLift = async () => ({ ok: true as const, liftedAt: "2026-10-20T12:00:00.000Z", pausedAt: "2026-10-13T00:00:00.000Z" });
const base: BillingCardView = {
  status: "unbilled", plan: null, usage: [], since: null, nextInvoice: null, link: null,
  planOptions: [{ id: "p1", name: "Growth", price: "$149.00/month" }, { id: "p2", name: "Pro", price: "$299.00/month" }],
  defaultEmail: "owner@example.com",
  can: { send: true, changePlan: false, markComplimentary: true, stopComplimentary: false, copyLink: false, liftPause: false },
  stripeReady: true,
  webhookReady: true,
  pause: null,
  lifted: null,
  pauseOff: false,
  reconciliation: [],
  reconciliationUnchecked: false,
};
type Actions = Pick<Parameters<typeof BillingCard>[0], "send" | "markComplimentary" | "stopComplimentary" | "changePlan" | "liftPause" | "undoLiftPause">;
const props = (view: BillingCardView, actions: Partial<Actions> = {}) => ({
  view, send: ok, markComplimentary: ok, stopComplimentary: ok, changePlan: ok, liftPause: okLift, undoLiftPause: ok, ...actions,
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
  can: { send: false, changePlan: true, markComplimentary: false, stopComplimentary: false, copyLink: false, liftPause: false },
};
// On p2, NOT planOptions[0]: "the SAME plan" must be tellable from "the
// first plan in the list" (review I-3).
const complimentary: BillingCardView = {
  ...active, status: "complimentary", nextInvoice: null, plan: { id: "p2", name: "Pro", price: "$299.00/month" },
  can: { send: true, changePlan: true, markComplimentary: false, stopComplimentary: true, copyLink: false, liftPause: false },
};
const LIVE_LINK = { sentTo: "owner@example.com", expires: "Oct 16, 3:30 PM", url: "https://checkout.stripe.com/x" };
// A paused account the agency can lift (G19): the payment line, no
// noForward yet (under 30 days), Lift pause offered.
const paused: BillingCardView = {
  ...base, status: "paused", plan: { id: "p1", name: "Growth", price: "$149.00/month" },
  can: { ...base.can, send: false, markComplimentary: false, liftPause: true },
  pause: { line: "Paused since Oct 13: the payment failed on Oct 6.", noForward: null },
};

/** Copied from lib/history-state.test.ts (itself from packages/db's
 *  cascade-export-boundary test): a source pin must not be satisfiable by a
 *  comment that merely quotes the code. */
function stripComments(src: string): string {
  let out = "";
  let mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; i++; continue; }
      if (c === "/" && d === "*") { mode = "block"; i++; continue; }
      if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      out += c;
      continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } continue; }
    if (mode === "block") {
      if (c === "*" && d === "/") { mode = "code"; i++; } else if (c === "\n") out += c;
      continue;
    }
    if (c === "\\") { out += c + (d ?? ""); i++; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) {
      mode = "code";
    }
    out += c;
  }
  return out;
}
/** PlanDialog's own code, comments out: from its declaration to the next export. */
function planDialogCode(): string {
  const code = stripComments(cardSource);
  const start = code.indexOf("function PlanDialog(");
  if (start === -1) throw new Error("PlanDialog not found");
  const end = code.indexOf("\nexport ", start);
  return code.slice(start, end === -1 ? undefined : end);
}

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
      can: { send: true, changePlan: false, markComplimentary: false, stopComplimentary: false, copyLink: true, liftPause: false },
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
    // The same line shows on a PAID account, where no link is being sent, so
    // it must say billing can't change, not that a link can't go (review M-4).
    expect(renderedText(render({ ...active, stripeReady: false }))).toContain(m["billing.card.noStripe"]);
    expect(m["billing.card.noStripe"]).not.toMatch(/billing link/i);
  });

  it("with the key but no webhook secret it says billing links are off, not that Stripe is disconnected, and never promises a link it cannot send; with neither, only the key is named, because it is the first thing to fix (final review I1) (mutation: drop the webhookReady notice → FAILS; show noStripe for it → FAILS; keep the empty line → FAILS)", () => {
    const noHook = renderedText(render({ ...base, webhookReady: false, can: { ...base.can, send: false } }));
    expect(noHook).toContain(m["billing.card.noWebhook"]);
    expect(noHook).not.toContain(m["billing.card.noStripe"]);
    expect(noHook).not.toContain(m["billing.card.empty"]);
    expect(renderedText(render(base))).not.toContain(m["billing.card.noWebhook"]);
    const neither = renderedText(render({ ...base, stripeReady: false, webhookReady: false, can: { ...base.can, send: false } }));
    expect(neither).toContain(m["billing.card.noStripe"]);
    expect(neither).not.toContain(m["billing.card.noWebhook"]);
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

  it("the skeleton's fixed-width bars cap at their card's width, so a 320px screen never scrolls sideways (design check 1a, M8: w-48 overran by 10px; mutation: drop max-w-full -> FAILS)", () => {
    const skeleton = renderToStaticMarkup(createElement(BillingCardSkeleton));
    const bars = skeleton.match(/<div[^>]*data-slot="skeleton"[^>]*class="[^"]*\bw-(?:48|40|36)\b[^"]*"/g) ?? [];
    expect(bars.length).toBeGreaterThanOrEqual(5);
    for (const b of bars) expect(b).toContain("max-w-full");
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
  });

  it("the dialog runs on those two and posts the id its STATE holds: every opening goes through dialogOpened, every answer through dialogAfter, and the hidden field reads state.requestId, never one minted at render (comments stripped, so a comment quoting the code cannot satisfy it) (mutation: mint per render → FAILS; bypass dialogAfter and leave the call in a comment → FAILS)", () => {
    const code = planDialogCode();
    expect(code).toContain("setState((s) => dialogAfter(s, outcome, mintRequestId));");
    expect(code).toContain("setState((s) => (next ? dialogOpened(mintRequestId) : { ...s, open: false }))");
    expect(code).toContain("requestId={withRequestId ? state.requestId : null}");
    expect(code.match(/mintRequestId\(\)/g)).toBeNull();
  });

  it("the Change-plan 'unconfirmed' copy never promises 'Nothing was charged' and says to check the plan first (mutation: reword it to promise nothing was charged → FAILS; the action's mapping to this key is guarded in billing-actions.test.ts)", () => {
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
    // The account's OWN plan (p2), not the first in the list (p1).
    expect(remark.mock.calls[0]![0].get("planId")).toBe("p2");

    const change = vi.fn<(f: FormData) => Promise<{ ok: true }>>(async () => ({ ok: true as const }));
    const compChange = byProp(BillingCard(props(complimentary, { changePlan: change })), "trigger", m["billing.changePlan"]);
    await (compChange.props.onSubmit as (f: FormData) => Promise<unknown>)(form({ planId: "p1", expectedPlanId: "p2", requestId: "r1" }));
    undoOf(toasts.success.mock.calls.length - 1).onClick();
    await flush();
    const back = change.mock.calls[1]![0];
    expect([back.get("planId"), back.get("expectedPlanId")]).toEqual(["p2", "p1"]);
    expect(back.get("requestId")).not.toBe("r1");

    toasts.success.mockReset();
    const paidChange = byProp(BillingCard(props(active)), "trigger", m["billing.changePlan"]);
    await (paidChange.props.onSubmit as (f: FormData) => Promise<unknown>)(form({ planId: "p2", expectedPlanId: "p1", requestId: "r2" }));
    expect(toasts.success).toHaveBeenCalledWith(m["billing.changePlan.done"], undefined);
  });

  it("Stop complimentary while a billing link is still live runs WITHOUT an Undo (Mark complimentary refuses while a link is out, so that Undo could only fail) and says the link is still open; with no link it keeps its Undo (review I-1) (mutation: always offer the Undo → FAILS; drop the link copy → FAILS)", async () => {
    const remark = vi.fn(ok);
    const withLink: BillingCardView = { ...complimentary, link: LIVE_LINK, can: { ...complimentary.can, copyLink: true } };
    const stopButton = byProp(BillingCard(props(withLink, { markComplimentary: remark })), "children", m["billing.comp.stop"]);
    (stopButton.props.onClick as () => void)();
    await flush();
    expect(toasts.success).toHaveBeenCalledOnce();
    expect(toasts.success).toHaveBeenCalledWith(m["billing.comp.stoppedLinkOpen"], undefined);
    expect(remark).not.toHaveBeenCalled();

    toasts.success.mockReset();
    const plain = byProp(BillingCard(props(complimentary)), "children", m["billing.comp.stop"]);
    (plain.props.onClick as () => void)();
    await flush();
    const [text, opts] = toasts.success.mock.calls[0]! as [string, { action?: { label: string } } | undefined];
    expect(text).toBe(m["billing.comp.stopped"]);
    expect(opts?.action?.label).toBe(m["common.undo"]);
  });

  it("a PAID Change plan that crashes says Stripe didn't confirm it (the change may have landed before the mirror failed), never 'reload and try again'; other crashes keep the generic copy (review M-1) (mutation: use common.actionCrashed for the paid change → FAILS)", async () => {
    const boom = async () => { throw new Error("network"); };
    const paid = byProp(BillingCard(props(active, { changePlan: boom })), "trigger", m["billing.changePlan"]);
    expect(await (paid.props.onSubmit as (f: FormData) => Promise<unknown>)(form({ planId: "p2" }))).toEqual({ kind: "crashed" });
    expect(toasts.error).toHaveBeenLastCalledWith(m["billing.error.changePlanUnconfirmed"]);

    const comp = byProp(BillingCard(props(complimentary, { changePlan: boom })), "trigger", m["billing.changePlan"]);
    await (comp.props.onSubmit as (f: FormData) => Promise<unknown>)(form({ planId: "p1" }));
    expect(toasts.error).toHaveBeenLastCalledWith(m["common.actionCrashed"]);
    const send = byProp(BillingCard(props(base, { send: boom })), "trigger", m["billing.send"]);
    await (send.props.onSubmit as (f: FormData) => Promise<unknown>)(form({ planId: "p1", email: "a@b.co" }));
    expect(toasts.error).toHaveBeenLastCalledWith(m["common.actionCrashed"]);
  });

  describe("Copy link (review M-3)", () => {
    const linkView: BillingCardView = {
      ...base, status: "link_sent", link: LIVE_LINK,
      can: { send: true, changePlan: false, markComplimentary: false, stopComplimentary: false, copyLink: true, liftPause: false },
    };
    const click = async () => {
      const button = byProp(BillingCard(props(linkView)), "children", m["billing.link.copy"]);
      (button.props.onClick as () => void)();
      await flush();
    };
    afterEach(() => vi.unstubAllGlobals());

    it("copies the CHECKOUT URL, not the address it was sent to (mutation: writeText(sentTo) → FAILS)", async () => {
      const writeText = vi.fn(async () => {});
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      await click();
      expect(writeText).toHaveBeenCalledWith(LIVE_LINK.url);
      expect(toasts.success).toHaveBeenCalledWith(m["billing.link.copied"]);
    });

    it("with no clipboard, or a denied one, says so plainly and hands over the URL to copy by hand, never the 'page may be out of date' crash copy (mutation: drop the missing-clipboard guard → it throws, FAILS; map a denial to common.actionCrashed → FAILS)", async () => {
      vi.stubGlobal("navigator", {});
      await click();
      expect(toasts.error).toHaveBeenLastCalledWith(m["billing.link.copyFailed"], expect.objectContaining({ description: LIVE_LINK.url }));
      vi.stubGlobal("navigator", { clipboard: { writeText: async () => { throw new Error("NotAllowedError"); } } });
      await click();
      expect(toasts.error).toHaveBeenLastCalledWith(m["billing.link.copyFailed"], expect.objectContaining({ description: LIVE_LINK.url }));
      expect(toasts.error).not.toHaveBeenCalledWith(m["common.actionCrashed"]);
    });
  });

  describe("Lift pause and its lines (plan G3, G19; Task 11)", () => {
    it("shows the pause line, and from day 30 while the switch enforces it, the no-forward line too — straight from the view, nothing computed here (mutation: drop either line → FAILS)", () => {
      expect(renderedText(render(paused))).toContain("Paused since Oct 13: the payment failed on Oct 6.");
      const withForward: BillingCardView = { ...paused, pause: { ...paused.pause!, noForward: m["billing.card.noForward"] } };
      expect(renderedText(render(withForward))).toContain(m["billing.card.noForward"]);
      expect(renderedText(render(paused))).not.toContain(m["billing.card.noForward"]);
    });

    it("shows the lifted line when the view carries one, and the pause-off line when the switch does not enforce a stored pause (mutation: drop either line → FAILS)", () => {
      const lifted: BillingCardView = { ...base, status: "payment_failed", lifted: m["billing.card.lifted"].replace("{date}", "Oct 26") };
      expect(renderedText(render(lifted))).toContain("Pause lifted Oct 26.");
      const pauseOff: BillingCardView = { ...paused, pauseOff: true };
      expect(renderedText(render(pauseOff))).toContain(m["billing.card.pauseOff"]);
      expect(renderedText(render(paused))).not.toContain(m["billing.card.pauseOff"]);
    });

    it("shows the reconciliation block (title, every line, and the runbook help) only when the view carries any (mutation: render it unconditionally → FAILS; mutation: drop the help line → FAILS)", () => {
      expect(renderedText(render(base))).not.toContain(m["billing.card.reconcile.title"]);
      const withMismatch: BillingCardView = {
        ...base, reconciliation: ["Call minutes: Stripe counts 500, BIS counts 480. Checked Oct 20, 3:00 PM."],
      };
      const text = renderedText(render(withMismatch));
      expect(text).toContain(m["billing.card.reconcile.title"]);
      expect(text).toContain("Call minutes: Stripe counts 500, BIS counts 480. Checked Oct 20, 3:00 PM.");
      expect(text).toContain(m["billing.card.reconcile.help"]);
    });

    it("an unchecked reconciliation shows one line in place of the mismatch block (design review I2) (mutation: drop the line → FAILS; show the mismatch title too → FAILS)", () => {
      expect(renderedText(render(base))).not.toContain(m["billing.card.reconcile.unavailable"]);
      const text = renderedText(render({ ...base, reconciliationUnchecked: true }));
      expect(text).toContain(m["billing.card.reconcile.unavailable"]);
      expect(text).not.toContain(m["billing.card.reconcile.title"]);
    });

    it("Lift pause is a ghost button, never a second primary — even beside Send (DESIGN rule 8) (mutation: give it the default/primary variant → FAILS)", () => {
      const withSendToo: BillingCardView = { ...paused, can: { ...paused.can, send: true } };
      expect(render(withSendToo).match(/btn-primary/g)?.length ?? 0).toBe(1);
      const button = byProp(BillingCard(props(paused)), "children", m["billing.card.liftPause"]);
      expect(button.props.variant).toBe("ghost");
      expect(renderedText(render(paused))).toContain(m["billing.card.liftPauseHelp"]);
    });

    it("renders no Lift pause button when the view does not offer it (mutation: show it unconditionally → FAILS)", () => {
      expect(renderedText(render(base))).not.toContain(m["billing.card.liftPause"]);
    });

    it("Lift pause runs immediately and toasts 'Pause lifted.' with an Undo that re-pauses using the EXACT liftedAt/pausedAt the Lift itself returned, then toasts 'Paused again.' (mutation: pass Date.now() instead of the returned liftedAt → FAILS; mutation: swap liftedAt and pausedAt → FAILS)", async () => {
      const lift = vi.fn(okLift);
      const undo = vi.fn(ok);
      const button = byProp(BillingCard(props(paused, { liftPause: lift, undoLiftPause: undo })), "children", m["billing.card.liftPause"]);
      (button.props.onClick as () => void)();
      await flush();
      expect(lift).toHaveBeenCalledOnce();
      expect(toasts.success.mock.calls[0]![0]).toBe(m["billing.card.liftedToast"]);
      const opts = toasts.success.mock.calls[0]![1] as { action: { label: string; onClick: () => void } };
      expect(opts.action.label).toBe(m["common.undo"]);

      opts.action.onClick();
      await flush();
      expect(undo).toHaveBeenCalledWith("2026-10-20T12:00:00.000Z", "2026-10-13T00:00:00.000Z");
      expect(toasts.success.mock.calls.at(-1)![0]).toBe(m["billing.card.repausedToast"]);
    });

    it("a crashed Lift pause shows the generic crash toast and never claims the pause was lifted (mutation: swallow the throw and toast liftedToast anyway → FAILS)", async () => {
      const boom = async () => { throw new Error("network"); };
      const button = byProp(BillingCard(props(paused, { liftPause: boom })), "children", m["billing.card.liftPause"]);
      (button.props.onClick as () => void)();
      await flush();
      expect(toasts.error).toHaveBeenCalledWith(m["common.actionCrashed"]);
      expect(toasts.success).not.toHaveBeenCalled();
    });

    it("a refused Lift pause toasts the server's reason, not the success copy (mutation: toast success regardless of r.ok → FAILS)", async () => {
      const refused = vi.fn(async () => ({ ok: false as const, error: m["billing.error.notPaused"] }));
      const button = byProp(BillingCard(props(paused, { liftPause: refused })), "children", m["billing.card.liftPause"]);
      (button.props.onClick as () => void)();
      await flush();
      expect(toasts.error).toHaveBeenCalledWith(m["billing.error.notPaused"]);
      expect(toasts.success).not.toHaveBeenCalled();
    });
  });
});
