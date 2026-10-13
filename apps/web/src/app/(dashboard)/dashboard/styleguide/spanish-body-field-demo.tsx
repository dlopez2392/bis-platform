"use client";

import { SpanishBodyField } from "@/components/spanish-body-field";

/**
 * S-09 PR 2 Task 14: the Spanish box every editable automatic message shares, in three of its four
 * stored shapes: nothing stored (our Spanish, pre-filled), stale (the stored row no longer matches a
 * changed English), and emptied (the stored row is the empty string, so Spanish customers get the
 * English message). A client component of its own because `composeEs` is a function, and a server
 * component cannot pass a function to a client one (rail-states.tsx's reasoning).
 */
const compose = (text: string) => text;
const DEFAULT_ES = "Gracias por su visita.";

export function SpanishBodyFieldDemo() {
  return (
    <div className="grid w-full gap-4 md:grid-cols-2">
      <SpanishBodyField idPrefix="sg-sbf-our" stored={{ bodyEs: null, stale: false }} defaultEs={DEFAULT_ES} composeEs={compose} sms />
      <SpanishBodyField idPrefix="sg-sbf-stale" stored={{ bodyEs: "Mensaje viejo.", stale: true }} defaultEs={DEFAULT_ES} composeEs={compose} sms />
      <SpanishBodyField idPrefix="sg-sbf-emptied" stored={{ bodyEs: "", stale: false }} defaultEs={DEFAULT_ES} composeEs={compose} sms />
    </div>
  );
}
