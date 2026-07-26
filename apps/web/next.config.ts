import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @bis/db ships TypeScript source (no build step); Next must compile it.
  transpilePackages: ["@bis/db"],
};

export default nextConfig;
