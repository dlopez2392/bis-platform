import {
  SurfaceStateNote, capabilityLink, capabilityPill, capabilitySentenceKey, sofiaLink, sofiaPill, sofiaSentenceKey, type SurfaceReader,
} from "@/components/surface-state-note";
import { makeTr } from "@/lib/record/copy";
import type { Capability, CapabilityGrade } from "@/lib/surfaces/capabilities";

/**
 * F-088 PR 2: the five surface states as one note each, for Sofía, in English, Spanish and the QA pseudo-locale
 * (+35% length). The bigger-plan row is the Owner's (it carries the Plan and billing link); setup is the client's
 * wording. Each note sits on a card so the glass reads as it does on the Calls screen.
 */
const OWNER: SurfaceReader = { isAgency: false, role: "owner" };
const GRADES: CapabilityGrade[] = [
  { state: "live", reason: "sofia_testing" },
  { state: "needs_setup", reason: "sofia_off" },
  { state: "needs_setup", reason: "calls_forwarded" },
  { state: "needs_setup", reason: "read_failed" },
  { state: "waiting", reason: "billing_paused" },
  { state: "bigger_plan", reason: "plan_no_voice" },
  { state: "absent", reason: "crm_only_trade" },
];
/** The `align="start"` row, as "What your plan includes" on Plan and billing lays it out: capability name, then the note. */
const ROWS: { cap: Capability; grade: CapabilityGrade }[] = [
  { cap: "sofia", grade: { state: "bigger_plan", reason: "plan_no_voice" } },
  { cap: "webChat", grade: { state: "needs_setup", reason: "chat_off" } },
  { cap: "texting", grade: { state: "waiting", reason: "carrier_review" } },
];
const COLUMNS = [
  { locale: "en" as const, pseudo: false, label: "English" },
  { locale: "es" as const, pseudo: false, label: "Español" },
  { locale: "en" as const, pseudo: true, label: "Pseudo-locale" },
];

export function SurfaceStateStates() {
  return (
    <div className="grid w-full gap-4 lg:grid-cols-3">
      {COLUMNS.map((col) => {
        const tr = makeTr(col.locale, col.pseudo);
        return (
          <div key={col.label} className="flex min-w-0 flex-col gap-3" data-surface-column={col.label}>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-3)]">{col.label}</p>
            {GRADES.map((grade) => (
              <div key={grade.reason} className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-card)]">
                <SurfaceStateNote
                  state={grade.state}
                  sentence={tr.text(sofiaSentenceKey(grade, OWNER))}
                  word={sofiaPill(grade, col.locale, col.pseudo)}
                  link={sofiaLink(grade, OWNER, "demo", col.locale, col.pseudo)}
                  locale={col.locale}
                  pseudo={col.pseudo}
                />
              </div>
            ))}
            <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-card)]" data-surface-rows>
              <ul className="flex flex-col divide-y divide-[var(--line)]">
                {ROWS.map(({ cap, grade }) => (
                  <li key={cap} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                    <h4 className="text-sm font-medium text-foreground">{tr.text(`surface.cap.${cap}`)}</h4>
                    <SurfaceStateNote
                      align="start"
                      state={grade.state}
                      sentence={tr.text(capabilitySentenceKey(cap, grade, OWNER))}
                      word={capabilityPill(cap, grade, col.locale, col.pseudo)}
                      link={capabilityLink(cap, grade, OWNER, "demo", col.locale, col.pseudo)}
                      locale={col.locale}
                      pseudo={col.pseudo}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}
