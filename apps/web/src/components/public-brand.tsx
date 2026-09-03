/**
 * The brand header above every public, customer-facing page — the lead form,
 * the booking page and the cancel page.
 *
 * One component and one stylesheet replace three near-identical copies that
 * had drifted apart: the form's capped its logo at 40px and gave the row the
 * form's own measure, while the booking and cancel copies used a fixed 28px
 * logo and NO measure at all, so on a wide viewport the client's logo hung at
 * the far left while the column it heads sat centred.
 *
 * Returns null rather than an empty wrapper when there is nothing to show:
 * an unbranded form must still render exactly what it rendered before M4b,
 * byte for byte.
 *
 * The measure is deliberately NOT baked in here — each route sets
 * `--public-measure` to its own column width, because they differ (34rem for
 * the form, 480px for the booking flow). Hard-coding one would misalign two
 * of the three surfaces, which is the bug this component exists to fix.
 */
export function PublicBrand({
  name,
  logoUrl,
}: {
  name: string | null;
  logoUrl: string | null;
}) {
  if (!name && !logoUrl) return null;

  return (
    <div className="bis-brand">
      {logoUrl ? (
        // Decorative: when the brand name is beside it the text already carries
        // the meaning, and when it is not, there is no text to honestly borrow
        // — inventing alt copy for a logo we know nothing about would be worse
        // than leaving it silent.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="bis-brand-logo" />
      ) : null}
      {name ? <span className="bis-brand-name">{name}</span> : null}
    </div>
  );
}
