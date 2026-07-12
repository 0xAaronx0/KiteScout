import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',

  // The legacy end-user finder is decommissioned (2026-07-12) — kitescout.tech
  // is admin-only (/admin/media, /changes) + the /api/cruise-map endpoint for
  // the standalone map shell. Stray visitors go to the real product.
  async redirects() {
    return [
      { source: '/', destination: 'https://kitescout.bstoked.net', permanent: false },
      { source: '/cruise', destination: 'https://kitescout.bstoked.net', permanent: false },
    ];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // no-referrer matters here: the admin key travels as ?key=… — external
          // links from admin pages must never leak it via the Referer header.
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
};

export default config;
