import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This project lives under a home dir that has its own stray lockfile;
  // pin the tracing root to this folder so Next doesn't guess the wrong one.
  outputFileTracingRoot: __dirname,
  images: {
    remotePatterns: [
      // IKEA product imagery (served via parse.bot results)
      { protocol: "https", hostname: "**.ikea.com" },
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
