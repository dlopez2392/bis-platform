import type { NextUpView } from "@/lib/record/next-up";
import { ADD_TODO_FIELD_ID } from "./constants";
import { FocusFieldButton } from "./focus-field-button";

/**
 * Next up (spec §9.3): read-only rows; Done stays on the timeline. Rows are --row-line rules.
 * `addTodoLabel` is null when the timeline (which holds the To-do field) did not render: an action
 * with nothing behind it is hidden (D3).
 */
export function NextUpBody({ view, emptyText, addTodoLabel }: { view: NextUpView; emptyText: string; addTodoLabel: string | null }) {
  const undated = view.undated ? <p className="text-xs text-muted-foreground">{view.undated}</p> : null;
  if (view.rows.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{emptyText}</p>
        {undated}
        {addTodoLabel ? <FocusFieldButton targetId={ADD_TODO_FIELD_ID} label={addTodoLabel} /> : null}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <ul className="flex flex-col text-sm">
        {view.rows.map((r) => (
          <li key={`${r.kind}-${r.id}`} data-next-up-row={r.kind} className="border-t border-[var(--row-line)] py-[7px] first:border-t-0">
            {r.kind === "booking" ? (
              <p className="tabular-nums text-card-foreground">{r.label}</p>
            ) : (
              <>
                <p className="truncate font-medium text-card-foreground" title={r.title}>{r.title}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                  {r.overdue ? <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-[var(--warn)]" /> : null}
                  <span className={r.overdue ? "text-[var(--warn)]" : undefined}>{r.detail}</span>
                </p>
              </>
            )}
          </li>
        ))}
      </ul>
      {undated}
    </div>
  );
}
