import type { ReactNode } from "react";

/**
 * The /r page's small pieces. Server components, no state: every press is a form whose action is a server action,
 * so the page works with no JavaScript.
 */

/**
 * THE review button. One component, and it is told NOTHING about the answer: its props are the action it presses
 * and the words on it, so there is no parameter a code path could use to hide it, shrink it or reword it for one
 * answer (plan D1; the same-button test renders all three answers and compares it byte for byte). It is a POST
 * form, not a link, so the press can be counted (the action stamps it, then redirects to the stored link) and a
 * scanner that only fetches the page cannot press it. The only primary on the screen it appears on (rule 8).
 */
export function ReviewButton({ action, label }: { action: (formData: FormData) => void | Promise<void>; label: string }) {
  return (
    <form action={action} className="bis-checkin-review" data-testid="checkin-review">
      <button type="submit" className="bis-checkin-primary">{label}</button>
    </form>
  );
}

/** A title and a detail in ONE language: the not-valid page of a link that did verify. */
export function Message({ title, detail }: { title: string; detail: string }) {
  return (
    <>
      <h1 className="bis-checkin-title">{title}</h1>
      <p className="bis-checkin-detail">{detail}</p>
    </>
  );
}

/** A title and a detail in both languages, stacked, each in its own `lang`: for a page with no language to trust. */
export function StackedMessage({ en, es }: { en: { title: string; detail: string }; es: { title: string; detail: string } }) {
  return (
    <>
      <section lang="en" className="bis-checkin-lang">
        <h1 className="bis-checkin-title">{en.title}</h1>
        <p className="bis-checkin-detail">{en.detail}</p>
      </section>
      <section lang="es" className="bis-checkin-lang">
        <h1 className="bis-checkin-title">{es.title}</h1>
        <p className="bis-checkin-detail">{es.detail}</p>
      </section>
    </>
  );
}

/** The answered screen: what they said, the one sentence that differs by answer, then the button (or nothing). */
export function ThankYou({ yourAnswer, sentence, children }: { yourAnswer: string; sentence: string; children?: ReactNode }) {
  return (
    <>
      <h1 className="bis-checkin-title">{yourAnswer}</h1>
      <p className="bis-checkin-sentence">{sentence}</p>
      {children}
    </>
  );
}
