"use client";

import { useActionState, useEffect, useRef } from "react";
import type { FormField, FormTheme } from "@bis/db";
import { HONEYPOT_FIELD, RENDER_TOKEN_FIELD } from "@/lib/forms/guards";
import type { PublicStrings } from "@/lib/forms/public-strings";
import { IDLE, type SubmitResult } from "./submit-result";

// redirectUrl is operator-configured free text (the form's success redirect
// setting), not something either the standalone page or the iframe embed can
// trust blindly — only ever hand off http(s); anything else (e.g. a
// `javascript:` URL) is dropped rather than executed or forwarded to the
// embed script. Shared so both destinations apply the identical rule instead
// of duplicating the literal comparison.
function isSafeRedirectUrl(url: string): boolean {
  let scheme: string | null = null;
  try {
    scheme = new URL(url, window.location.href).protocol;
  } catch {
    scheme = null;
  }
  return scheme === "http:" || scheme === "https:";
}

export function PublicForm({
  fields,
  theme,
  locale,
  strings,
  renderToken,
  attribution,
  action,
}: {
  fields: FormField[];
  theme: FormTheme;
  locale: "en" | "es";
  strings: PublicStrings;
  renderToken: string;
  attribution: string;
  action: (prev: SubmitResult, formData: FormData) => Promise<SubmitResult>;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const rootRef = useRef<HTMLDivElement>(null);

  // `app/f/layout.tsx` cannot read `?locale=` (no access to searchParams in a
  // root layout) and the locale can also be overridden per-request by that
  // query param, so the server always emits `<html lang="en">`. This corrects
  // it after hydration for whichever locale actually resolved — screen readers
  // and translation tooling see the honest language, just one tick late. The
  // server-emitted value is the known, accepted gap here, not something this
  // effect can close.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Report height to the embedding page. The iframe cannot size itself, so
  // without this the form is either clipped or floats in dead space.
  useEffect(() => {
    const node = rootRef.current;
    if (!node || window.parent === window) return;
    const post = () => window.parent.postMessage(
      { type: "bis-form-height", height: node.getBoundingClientRect().height + 8 }, "*");
    post();
    const observer = new ResizeObserver(post);
    observer.observe(node);
    return () => observer.disconnect();
  }, [state.status]);

  // A redirect fired inside a 300px iframe navigates the iframe, not the page.
  useEffect(() => {
    if (state.status !== "success" || !state.redirectUrl) return;
    // Gate both destinations on the same check: don't post a message the
    // embed script will only discard, and don't navigate the standalone page
    // to a scheme it shouldn't. This is also the backstop if a future embed
    // consumer ever forgets to check the scheme on its own side.
    if (!isSafeRedirectUrl(state.redirectUrl)) return;
    if (window.parent !== window) {
      window.parent.postMessage({ type: "bis-form-redirect", url: state.redirectUrl }, "*");
    } else {
      window.location.href = state.redirectUrl;
    }
  }, [state]);

  const errors = state.status === "invalid" ? state.fieldErrors : {};

  return (
    <div
      ref={rootRef}
      className="bis-form"
      style={{
        // The account's tokens — accent, corners, typeface, surfaces — are
        // emitted once on <main> by page.tsx and inherit down here. They are
        // deliberately NOT re-emitted on this element: an inline custom
        // property set here would outrank the `prefers-color-scheme: dark`
        // rule that a `follow` tenant's page carries, and that tenant's form
        // would stay light on a dark device with everything appearing to work.
        //
        // This stays because it is the form's own setting, not the account's:
        // the host page owns the backdrop when the operator says so.
        background: theme.transparentBackground ? "transparent" : undefined,
      } as React.CSSProperties}
    >
      {state.status === "success" ? (
        <p role="status" className="bis-form-success">{state.message}</p>
      ) : (
        <form action={formAction} noValidate>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="attribution" value={attribution} />
          <input type="hidden" name={RENDER_TOKEN_FIELD} value={renderToken} />
          {/* Off-screen rather than display:none — some bots skip hidden
              inputs but fill anything they can find in the DOM. */}
          <div className="bis-form-hp" aria-hidden>
            <label htmlFor={HONEYPOT_FIELD}>Do not fill this in</label>
            <input id={HONEYPOT_FIELD} name={HONEYPOT_FIELD} type="text" tabIndex={-1}
                   autoComplete="off" />
          </div>

          {fields.map((field) => (
            <Field key={field.key} field={field} error={errors[field.key]} strings={strings} />
          ))}

          {state.status === "invalid" && state.formError ? (
            <p role="alert" className="bis-form-error">{state.formError}</p>
          ) : null}

          {state.status === "error" ? (
            <p role="alert" className="bis-form-error">{strings.unavailable}</p>
          ) : null}

          <button type="submit" disabled={pending} className="bis-form-submit">
            {pending ? strings.submitting : strings.submit}
          </button>
        </form>
      )}
    </div>
  );
}

function Field({
  field, error, strings,
}: { field: FormField; error?: string; strings: PublicStrings }) {
  const id = `f_${field.key}`;
  const described = error ? `${id}_err` : undefined;

  if (field.kind === "consent") {
    return (
      <div className="bis-form-row bis-form-consent">
        <input id={id} name={field.key} type="checkbox" aria-describedby={described} />
        <label htmlFor={id}>{field.label}</label>
        {error ? <p id={described} role="alert" className="bis-form-error">{error}</p> : null}
      </div>
    );
  }

  const isMessage = field.kind === "message";
  return (
    <div className="bis-form-row">
      <label htmlFor={id}>
        {field.label}
        {field.required ? null : <span className="bis-form-optional"> ({strings.optional})</span>}
      </label>
      {isMessage ? (
        <textarea id={id} name={field.key} rows={4} placeholder={field.placeholder}
                  aria-describedby={described} aria-invalid={error ? true : undefined} />
      ) : (
        <input id={id} name={field.key}
               type={field.kind === "core.email" ? "email" : field.kind === "core.phone" ? "tel" : "text"}
               placeholder={field.placeholder} aria-describedby={described}
               aria-invalid={error ? true : undefined} />
      )}
      {error ? <p id={described} role="alert" className="bis-form-error">{error}</p> : null}
    </div>
  );
}
