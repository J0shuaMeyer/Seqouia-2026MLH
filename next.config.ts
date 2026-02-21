import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["react-globe.gl", "globe.gl", "three-globe"],
};

export default nextConfig;
