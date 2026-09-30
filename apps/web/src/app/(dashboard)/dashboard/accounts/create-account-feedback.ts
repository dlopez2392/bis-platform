import { unstable_rethrow } from "next/navigation";
import { m } from "@/lib/messages";
import type { CreateAccountResult } from "./actions";

/**
 * What the create dialog does with `createClientAccount`'s outcome, kept out
 * of the component so it can be tested without a DOM
 * (create-account-feedback.test.ts).
 *
 * Not `notifyActionResult` (lib/forms/action-feedback.ts), though the shape is
 * close: that helper catches EVERY rejection and toasts its crash copy, and a
 * successful create ends in `redirect()`, which Next.js implements by
 * throwing NEXT_REDIRECT — routed through it, every successful create would
 * be swallowed there and misreported as a failure, and the navigation would
 * never happen. So the redirect is rethrown here first, and only then does a
 * throw mean "unexpected" and get the generic line.
 *
 * A refusal the action RETURNS carries its own words (a blank name, an
 * unusable timezone, a test-shaped org id) and is shown as-is; the dialog
 * stays open with what the operator typed, so they can fix it and resubmit.
 */
export async function settleCreateAccount(
  run: () => Promise<CreateAccountResult>,
  ui: { close: () => void; error: (message: string) => void },
): Promise<void> {
  let result: CreateAccountResult;
  try {
    result = await run();
  } catch (e) {
    unstable_rethrow(e);
    ui.error(m["accounts.createFailed"]);
    return;
  }
  if (result.ok) ui.close();
  else ui.error(result.error);
}
