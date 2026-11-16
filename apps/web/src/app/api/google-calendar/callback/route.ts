import type { NextRequest } from "next/server";
import { handleGoogleCallback, liveGoogleDeps } from "@/lib/google/oauth-routes";

/** S-22 slice 1: Google sends the person back here. 404 while the feature is unconfigured (lib/google/oauth-routes.ts). */
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handleGoogleCallback(req, liveGoogleDeps());
}
