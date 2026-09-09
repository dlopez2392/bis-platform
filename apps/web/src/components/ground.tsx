// The dashboard's light source (Northern Lights spec §3.1): three static
// radial glows and a 48px grid masked to the top third, painted once behind
// sidebar and content. No images, no canvas, no animation — reduced-motion is
// irrelevant because nothing moves. Nothing else in the app knows it exists.
const glow = (size: string, at: string, token: string, alpha: string) =>
  `radial-gradient(${size} at ${at}, rgb(from var(${token}) r g b / var(${alpha})), transparent 60%)`;

const GLOWS = [
  glow("700px 420px", "12% -10%", "--accent", "--glow-1-alpha"),
  glow("620px 380px", "96% 8%", "--accent-2", "--glow-2-alpha"),
  glow("560px 360px", "60% 110%", "--accent", "--glow-3-alpha"),
].join(", ");

const GRID_LINE = "rgb(from var(--text-1) r g b / var(--grid-alpha))";
const GRID = `linear-gradient(${GRID_LINE} 1px, transparent 1px), linear-gradient(90deg, ${GRID_LINE} 1px, transparent 1px)`;
// A mask reads alpha only — `black` here is "opaque", not a painted colour.
const GRID_MASK = "radial-gradient(800px 500px at 30% 0%, black 20%, transparent 70%)";

export function Ground() {
  return (
    <div aria-hidden="true" data-slot="ground" className="pointer-events-none fixed inset-0 -z-10">
      <div className="absolute inset-0" style={{ backgroundImage: GLOWS }} />
      <div
        className="absolute inset-0"
        style={{ backgroundImage: GRID, backgroundSize: "48px 48px", maskImage: GRID_MASK, WebkitMaskImage: GRID_MASK }}
      />
    </div>
  );
}
