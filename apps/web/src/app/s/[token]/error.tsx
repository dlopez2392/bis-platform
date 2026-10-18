"use client";

import { m } from "@/lib/messages";
import { DOCREQ_CSS } from "../../d/[token]/docreq-css";

/**
 * The error boundary for `/s/<token>` (S-07 3b; `/d`'s twin), colocated at `[token]` so it renders INSIDE the
 * layout's shell. The pair, as `app/f/[publicId]/error.tsx` explains: the layout reads the page through
 * `loadPageSafe`, so the shell always stands; the page's own `loadPage` call re-throws the same rejected
 * read, and lands here. An error boundary receives no locale and the read that would have named it is
 * the one that failed, so both languages stand stacked, each in its own `lang` (the `/u` tree's
 * pattern). It never names what broke. `m` for its six strings and nothing else; no `@bis/db`.
 */
export default function SharedFileError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="bis-docreq-page">
      <style>{DOCREQ_CSS}</style>
      <div className="bis-docreq" role="alert">
        <section lang="en" className="bis-docreq-lang">
          <h1 className="bis-docreq-title">{m["customerDocs.error.title"]}</h1>
          <p className="bis-docreq-detail">{m["customerDocs.error.body"]}</p>
        </section>
        <section lang="es" className="bis-docreq-lang">
          <h1 className="bis-docreq-title">{m["customerDocs.error.title.es"]}</h1>
          <p className="bis-docreq-detail">{m["customerDocs.error.body.es"]}</p>
        </section>
        <div className="bis-docreq-actions">
          <button type="button" className="bis-docreq-primary" onClick={() => reset()}>
            {`${m["customerDocs.error.retry"]} / ${m["customerDocs.error.retry.es"]}`}
          </button>
        </div>
      </div>
    </main>
  );
}
