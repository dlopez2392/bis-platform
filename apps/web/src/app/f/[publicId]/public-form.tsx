"use client";

import { useActionState, useEffect, useRef } from "react";
import type { FormField, FormTheme } from "@bis/db";
import { HONEYPOT_FIELD, RENDER_TOKEN_FIELD } from "@/lib/forms/guards";
import type { PublicStrings } from "@/lib/forms/public-strings";
import { IDLE, type SubmitResult } from "./submit-result";

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
        // Themed rather than inheriting the host page: an iframe cannot read the
        // host's CSS, so these are what stop the form looking pasted in.
        "--accent": theme.accent ?? "#6d28d9",
        "--radius": theme.radius ?? "0.5rem",
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
