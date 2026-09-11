/**
 * BIS's own mark: a triangle knocked out of a disc.
 *
 * It has existed all along in exactly ONE place — a 256×256 frame inside
 * public/favicon.ico — and nothing in the app has ever drawn it. Re-cut here
 * as a single path so it can take a colour, instead of being a black-and-white
 * raster that only sits correctly on one ground.
 *
 * One path with `fillRule="evenodd"`, and that is the load-bearing detail: the
 * triangle is a genuine HOLE, not a second shape painted the surface colour.
 * That is what lets the same component sit on the sidebar's dark chrome, on a
 * glass card and over the lit ground without any caller telling it what is
 * behind — a triangle filled `--surface-0` would be the wrong dark on the rail.
 *
 * The disc paints `currentColor`, so a caller sets it with a text colour class
 * and the mark follows the theme. No colour literal lives here.
 */
const MARK_PATH = "M0 24A24 24 0 1 1 48 24A24 24 0 1 1 0 24ZM24 11.5L35.8 33L12.2 33Z";

export function BisMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      data-slot="bis-mark"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      className={className}
    >
      <path d={MARK_PATH} fillRule="evenodd" fill="currentColor" />
    </svg>
  );
}
