"use client";

import { stackedLines, stackedTitle } from "@/lib/checkin/copy";
import { CHECKIN_CSS } from "./checkin-css";

/**
 * The error boundary for `/r/<token>` (the /d tree's pair): colocated at `[token]` so it renders INSIDE the
 * layout's shell, which reads no database and so always stands. The page's own reads throw here. An error
 * boundary receives no locale, so both languages stand stacked, each in its own `lang`. It never names what broke.
 */
export default function CheckinError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const title = stackedLines("checkin.error.title");
  const detail = stackedLines("checkin.error.detail");
  return (
    <main className="bis-checkin-page">
      <style>{CHECKIN_CSS}</style>
      <div className="bis-checkin" role="alert">
        <section lang="en" className="bis-checkin-lang">
          <h1 className="bis-checkin-title">{title.en}</h1>
          <p className="bis-checkin-detail">{detail.en}</p>
        </section>
        <section lang="es" className="bis-checkin-lang">
          <h1 className="bis-checkin-title">{title.es}</h1>
          <p className="bis-checkin-detail">{detail.es}</p>
        </section>
        <div className="bis-checkin-tiles">
          <button type="button" className="bis-checkin-primary" onClick={() => reset()}>
            {stackedTitle("checkin.error.retry")}
          </button>
        </div>
      </div>
    </main>
  );
}
