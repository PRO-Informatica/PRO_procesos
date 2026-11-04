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
      // Service preview may include its companion Product (10 MiB per PDF).
      bodySizeLimit: "21mb",
    },
  },
};

export default nextConfig;
