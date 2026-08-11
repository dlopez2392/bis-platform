import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @bis/db ships TypeScript source (no build step); Next must compile it.
  transpilePackages: ["@bis/db"],
  experimental: {
    serverActions: {
      // The logo upload is a Server Action, and Next caps action bodies at 1 MB
      // by default. That cap made our OWN 512 KB check unreachable for exactly
      // the files it exists to reject: Next answered 413 before the action ran,
      // so an oversized logo produced a bare 500 in production instead of
      // "That file is larger than 512 KB." Raised so a slightly-too-big file
      // reaches our validation and gets a message that says what to do.
      //
      // This is a ceiling for the request, NOT a relaxation of the limit:
      // MAX_LOGO_BYTES stays 512 KB and is still enforced twice in
      // setBrandingAction, once on the reported size and once on the decoded
      // bytes. The panel also refuses oversized files before submitting.
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
