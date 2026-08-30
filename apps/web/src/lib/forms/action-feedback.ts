/**
 * Toast plumbing for the house `<form action={...}>` wrapper pattern.
 *
 * The naked version — `const result = await action(formData)` straight into
 * `toast` — has a hole: a server-action invocation can THROW, not just
 * return `{ok: false}`. The reliable real-world trigger is a tab loaded
 * before a redeploy: server-action ids are content-hashed per deployment, so
 * a stale tab's Save posts an id the new deployment doesn't recognize and
 * the call rejects before any of our code runs. Without a catch, that
 * rejection escapes the handler and the operator gets NOTHING — no toast,
 * no error page they associate with the click — a form that silently
 * ignores Save (hit live on 2026-08-29, two deploys under open tabs in one
 * day). `crashed` copy should therefore tell the operator the page may be
 * out of date and to reload, because that IS the most likely cause.
 *
 * Never rethrows: everything reaching here is a toastable failure, and
 * escalating it to an error boundary would swap a form the operator can
 * retry for a full-screen error page they can't.
 */
export async function notifyActionResult(
  run: () => Promise<{ ok: true } | { ok: false; error: string }>,
  notify: { success: (message: string) => void; error: (message: string) => void },
  message: { success: string; crashed: string },
): Promise<void> {
  let result: { ok: true } | { ok: false; error: string };
  try {
    result = await run();
  } catch {
    notify.error(message.crashed);
    return;
  }
  if (result.ok) notify.success(message.success);
  else notify.error(result.error);
}
