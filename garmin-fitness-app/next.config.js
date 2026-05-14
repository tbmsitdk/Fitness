/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['papaparse', 'jszip'],
  },
};

module.exports = nextConfig;
