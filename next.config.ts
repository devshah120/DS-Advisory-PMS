import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  images: {
    unoptimized: process.env.NODE_ENV === 'development',
  },
};

export default nextConfig;

