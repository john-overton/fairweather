import type { NextConfig } from 'next';

/** Served behind nginx at openglades.com/fairweather (see ../deploy/nginx-openglades.conf). */
export const BASE_PATH = '/fairweather';

const nextConfig: NextConfig = {
  basePath: BASE_PATH,
  env: { NEXT_PUBLIC_BASE_PATH: BASE_PATH },
  serverExternalPackages: ['better-sqlite3', 'web-push'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Lets the worker at /fairweather/sw.js control /fairweather (no trailing slash) too
        source: '/sw.js',
        headers: [
          { key: 'Service-Worker-Allowed', value: BASE_PATH },
          { key: 'Cache-Control', value: 'no-cache' },
        ],
      },
    ];
  },
};

export default nextConfig;
