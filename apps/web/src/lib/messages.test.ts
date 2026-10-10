import { describe, expect, it } from "vitest";
import { m } from "./messages";

/**
 * Internal roadmap labels must not reach a screen a client can open.
 *
 * The defect this file exists to stop: /calendar told every client "Calendar
 * is coming in M2". Three things wrong with one string, and no gate could see
 * any of them — it was present, correct, and rendered exactly as written.
 *   1. "M2" is an internal roadmap label. It means nothing to the reader.
 *   2. It promises a delivery the reader cannot evaluate or hold us to.
 *   3. The numbering has since DRIFTED, so it is wrong even internally: what
 *      shipped under the name M2 was client access, while the spec's M2 is the
 *      booking module the string was actually promising. A reader cannot tell
 *      which one it meant.
 *
 * Same class as the branding-panel slip that `panel-copy.test.ts` pins —
 * internal language surviving onto a client-facing surface — which is why it
 * gets a guard rather than just a fix.
 *
 * A client's sidebar is six items (Dashboard, Contacts, Opportunities,
 * Conversations, Forms, Calendar) plus their own Branding page. Everything
 * else is gated: Settings and the activation checklist by
 * `requireAgencyOnlyAccountAccess`, the dashboard's checklist panel by an
 * `isAgency` branch, and Companies/Blueprints by the agency-only shell.
 */
const INTERNAL_MILESTONE = /\bM\d[a-z]?\b/;

/**
 * The exceptions, deliberately NOT the coverage: the assertion runs over every
 * key in the catalogue, so a newly added string is checked by default and has
 * to be consciously named here to be exempt. Each of these renders only behind
 * an agency-only guard, where a roadmap label is a note to ourselves.
 */
// checklist.phone_number.help and checklist.gbp_connect.help WERE exempted
// here (both agency-only strings) until 2026-09-29, when both were rewritten
// to drop their milestone codes (checklist-catalogue.test.ts now runs a
// stricter, unconditional guard over every catalogue string, agency-only or
// not) — removed rather than left behind to wave through a future regression.
// settings.customValuesBody WAS exempted here (agency-only, requireAgency-
// OnlyAccountAccess in settings/page.tsx) until 2026-09-30, when it was
// rewritten to drop both its milestone code and its raw `{{...}}` template
// syntax — removed rather than left behind to wave through a future
// regression.
const AGENCY_ONLY = new Set<string>([]);

describe("messages", () => {
  it("cites no internal roadmap label on a client-reachable string", () => {
    for (const [key, value] of Object.entries(m)) {
      if (AGENCY_ONLY.has(key)) continue;
      expect(value, `"${key}" names an internal milestone: ${value}`)
        .not.toMatch(INTERNAL_MILESTONE);
    }
  });

  /**
   * Keeps the allowlist from rotting into silent permission. If one of these
   * gets reworded away from its label, the exemption should be deleted with
   * it — not left behind to wave through whatever a later edit puts there.
   */
  it("exempts only strings that actually carry a label", () => {
    for (const key of AGENCY_ONLY) {
      expect(m[key as keyof typeof m], `"${key}" no longer needs its exemption`)
        .toMatch(INTERNAL_MILESTONE);
    }
  });
});

/**
 * D-020. Threads also start from a text and from a form submission
 * (sms/inbound's route, forms/enrich.ts both call ensureConversation), not
 * only from an operator's own email — the empty state's one sentence said
 * otherwise (DESIGN.md rule 5: "one sentence of what appears here + the
 * action that causes it", and this one named only ONE of the real actions,
 * as if it were the only one).
 */
describe("conversations.empty.body (D-020)", () => {
  it("does not claim a thread starts only from an operator's own email, and names the real ways one starts", () => {
    const body = m["conversations.empty.body"];
    expect(body).not.toContain("Email a contact from their timeline");
    expect(body.toLowerCase()).toMatch(/\btext/);
    expect(body.toLowerCase()).toMatch(/\bform/);
  });
});

/**
 * Post-merge review of #228 (owner decision): the reserved-key strings named
 * "the source question" / "la pregunta de origen", a name the owner never
 * sees anywhere. The form editor calls that field "Who recommended you?"
 * (forms.kind.core.referral_source), so the settings copy names it the same
 * way, in each language, read off the catalogue rather than retyped.
 */
describe("settings.fieldKeyReserved / settings.fieldKeyFormat name the question the owner sees", () => {
  it.each([
    ["settings.fieldKeyReserved", "forms.kind.core.referral_source"],
    ["settings.fieldKeyFormat", "forms.kind.core.referral_source"],
    ["settings.fieldKeyReserved.es", "forms.kind.core.referral_source.es"],
    ["settings.fieldKeyFormat.es", "forms.kind.core.referral_source.es"],
  ] as const)("%s quotes the form editor's own label (mutation: restore \"source question\" → FAILS)", (key, label) => {
    expect(m[key]).toContain(`"${m[label]}"`);
    expect(m[key]).not.toMatch(/source question|pregunta de origen/i);
  });
});

describe("settings.fieldKeyReserved / settings.fieldKeyFormat say RESERVED in English, as the Spanish says reservado", () => {
  it.each(["settings.fieldKeyReserved", "settings.fieldKeyFormat"] as const)(
    "%s says \"is reserved for\" (mutation: \"is saved for\" → FAILS)", (key) => {
      expect(m[key]).toContain("\"referred_by\" is reserved for");
      expect(m[`${key}.es`]).toContain("\"referred_by\" está reservado para");
    });
});

/**
 * M4 (whole-branch review), Spanish copy. "Lista de tareas" (Checklist) read
 * as the same thing as "Pendientes" (To do) — tareas ARE to-dos — so the
 * checklist is a "Lista de verificación". "Valor en proceso" is not how a
 * Spanish-speaking owner names a pipeline; "embudo" is, and both pipeline
 * labels use it. "Preparación" (Setup) → "Configuración".
 */
describe("Spanish copy review (M4)", () => {
  it("names Checklist, Pipeline value, Pipeline added and Setup in the reviewed words (mutation: restore \"Lista de tareas\" → FAILS)", () => {
    expect(m["nav.checklist.es"]).toBe("Lista de verificación");
    expect(m["account.pipelineValue.es"]).toBe("Valor del embudo");
    expect(m["dashboard.kpi.pipelineAdded.es"]).toBe("Nuevo valor del embudo");
    expect(m["nav.setup.es"]).toBe("Configuración");
  });

  it("no two sidebar labels read the same in Spanish (mutation: give nav.checklist.es the same text as nav.tasks.es → FAILS)", () => {
    const spanishNav = Object.entries(m).filter(([k]) => k.startsWith("nav.") && k.endsWith(".es")).map(([, v]) => v);
    expect(new Set(spanishNav).size).toBe(spanishNav.length);
    expect(spanishNav.some((v) => /\btareas\b/i.test(v))).toBe(false);
  });
});
