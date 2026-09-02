// No branch matched "account" in the original StepActions, and STEP_PATH has
// no entry for it either, so this card has never rendered any rows, note, or
// panel — this mirrors that exactly. (Task 4 gives it a rename control.)
// Takes no props today — a function with fewer params than `StepDetailProps
// => React.ReactNode` calls for is still assignable to that type in
// STEP_DETAIL (setup-panel.tsx), since it simply ignores the rest.
export function AccountStep(): React.ReactNode {
  return null;
}
