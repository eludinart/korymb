import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Keep lint in CI/editor, but don't fail production image builds.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
