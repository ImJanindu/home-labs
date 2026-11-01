import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  output: "standalone",  /* This ouputs a standalone compact server during build to make it easy to deploy using docker. 
  Copy .next/static/ and public/ folders insisde the .next/standalone/ folder to make the css, media and other content work correctly */
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
