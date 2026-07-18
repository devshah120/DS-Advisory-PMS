import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

