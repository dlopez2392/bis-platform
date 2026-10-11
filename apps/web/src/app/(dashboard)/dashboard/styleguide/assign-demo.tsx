"use client";

import { AssigneeField } from "@/components/assign/assignee-field";
import type { AssignSave } from "@/components/assign/assign-handlers";
import { m } from "@/lib/messages";

/**
 * AssigneeField (components/assign/assignee-field.tsx), the "Assigned to"
 * inline pick on the contact drawer, the record page and task rows (F-085
 * part 1). A client component of its own because the field holds its pick in
 * state and takes a save function, which a server page cannot hand a client
 * one (rail-states.tsx's reasoning). The save here writes nothing: it answers
 * as a real one does, so the Undo toast shows. Editable beside read-only (a
 * Technician's view); Tab to the trigger to see its focus ring, Enter opens
 * the list, Esc closes it.
 */
const TEAM = [
  { userId: "sg-ana", label: "Ana Ruiz" },
  { userId: "sg-tom", label: "tom@rio.test" },
];

const demoSave: AssignSave = async () => ({ ok: true, undo: async () => ({ ok: true }) });

export function AssignDemo() {
  return (
    <dl className="grid w-full max-w-md gap-2">
      <div className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2">
        <dt className="text-xs text-muted-foreground">{m["assign.field.label"]}</dt>
        <dd className="min-w-0">
          <AssigneeField label={m["assign.field.label"]} value="sg-ana" options={TEAM} readOnly={false} save={demoSave} />
        </dd>
      </div>
      <div className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2">
        <dt className="text-xs text-muted-foreground">{m["assign.field.label"]}</dt>
        <dd className="min-w-0">
          <AssigneeField label={m["assign.field.label"]} value={null} options={TEAM} readOnly save={demoSave} />
        </dd>
      </div>
    </dl>
  );
}
