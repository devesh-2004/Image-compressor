import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so the build ignores any stray lockfiles
  // in parent directories (keeps Vercel builds unambiguous).
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
