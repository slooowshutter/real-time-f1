import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false, // it sits on the play button
  logging: { browserToTerminal: false },
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
