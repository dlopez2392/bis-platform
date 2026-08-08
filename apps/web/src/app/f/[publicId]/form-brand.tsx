/**
 * The brand header above a public lead form.
 *
 * This page had no header at all before this milestone — `<main>` opened
 * straight into `<form>`. So an unbranded form must still render exactly that,
 * byte for byte, which is why this returns null rather than an empty wrapper
 * when there is nothing to show.
 *
 * Styled from form.css rather than the dashboard's Tailwind tokens: this route
 * carries its own stylesheet and its own dark handling (`form.theme.mode`), and
 * is deliberately not part of the dashboard's token system.
 */
export function FormBrand({
  name,
  logoUrl,
}: {
  name: string | null;
  logoUrl: string | null;
}) {
  if (!name && !logoUrl) return null;

  return (
    <div className="bis-form-brand">
      {logoUrl ? (
        // Decorative: when the brand name is beside it the text already carries
        // the meaning, and when it is not, there is no text to honestly borrow
        // — inventing alt copy for a logo we know nothing about would be worse
        // than leaving it silent.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="bis-form-brand-logo" />
      ) : null}
      {name ? <span className="bis-form-brand-name">{name}</span> : null}
    </div>
  );
}
