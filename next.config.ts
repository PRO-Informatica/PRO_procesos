import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  logging: {
    incomingRequests: {
      // OAuth callbacks carry short-lived credentials in the query string.
      ignore: [/\/api\/integrations\/gmail\/callback/u],
    },
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "11mb",
    },
  },
};

export default nextConfig;
