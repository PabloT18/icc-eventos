import type { NextConfig } from "next";
import packageJson from "./package.json";

const version = process.env.NEXT_PUBLIC_APP_VERSION ?? packageJson.version;
const commit =
  process.env.NEXT_PUBLIC_BUILD_COMMIT ??
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
  "local";

const config: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_BUILD_COMMIT: commit,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=()" },
        ],
      },
    ];
  },
};
export default config;
