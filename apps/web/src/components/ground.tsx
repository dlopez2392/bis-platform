// The dashboard's light source (Northern Lights spec §3.1): three static
// radial glows and a 48px grid masked to the top third, painted once behind
// sidebar and content. No images, no canvas, no animation — reduced-motion is
// irrelevant because nothing moves. Nothing else in the app knows it exists.
const glow = (size: string, at: string, token: string, alpha: string) =>
  `radial-gradient(${size} at ${at}, rgb(from var(${token}) r g b / var(${alpha})), transparent 60%)`;

// Viewport-RELATIVE, not px: the mockup sizes its glows against a 1180×760
// frame (700×420 = 59%×55%, 620×380 = 53%×50%, 560×360 = 47%×47%), and the app
// paints them on the whole viewport. Held in px they shrank to corner smudges
// at 1440×900 and vanished at 1920×1080; in vw/vh the proportions survive every
// screen. Consequence: ON_CANVAS (theme.test.ts) is now viewport-independent —
// 1 − 10/(55·0.6) = 0.69697 — because the glow's radius and its off-canvas
// offset scale together.
const GLOWS = [
  glow("59vw 55vh", "12% -10%", "--accent", "--glow-1-alpha"),
  glow("53vw 50vh", "96% 8%", "--accent-2", "--glow-2-alpha"),
  glow("47vw 47vh", "60% 110%", "--accent", "--glow-3-alpha"),
].join(", ");

const GRID_LINE = "rgb(from var(--text-1) r g b / var(--grid-alpha))";
const GRID = `linear-gradient(${GRID_LINE} 1px, transparent 1px), linear-gradient(90deg, ${GRID_LINE} 1px, transparent 1px)`;
// A mask reads alpha only — `black` here is "opaque", not a painted colour.
const GRID_MASK = "radial-gradient(68vw 66vh at 30% 0%, black 20%, transparent 70%)";

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
