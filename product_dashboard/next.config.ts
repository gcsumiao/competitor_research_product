import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  outputFileTracingIncludes: {
    "/*": [
      "./data/code_reader_scanner/**/*.xlsx",
      "./data/code_reader_scanner/**/manifest.json",
      "./data/non_code_categories/**/*",
    ],
    // Consult Me seed deliverables. Scoped to the routes that touch the files
    // (download streams them; history/status stat them) so the "/*" bundle stays lean.
    "/api/consult-me/download": ["./data/consult-me-reports/**/*"],
    "/api/consult-me/history": ["./data/consult-me-reports/**/*"],
    "/api/consult-me/status": ["./data/consult-me-reports/**/*"],
    "/api/consult-me/public-status": ["./data/consult-me-reports/**/*"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "m.media-amazon.com",
      },
    ],
  },
};

export default nextConfig;
