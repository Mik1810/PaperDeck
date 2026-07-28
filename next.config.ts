import type { NextConfig } from "next";
import {
  PRIVATE_CACHE_HEADER_SOURCES,
  privateNoStoreHeaders,
} from "./src/lib/security/route-cache-policy";

const nextConfig: NextConfig = {
  poweredByHeader: false,

  async headers() {
    return [
      ...PRIVATE_CACHE_HEADER_SOURCES.map((source) => ({
        source,
        headers: [...privateNoStoreHeaders()],
      })),
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
