import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Old estimate-approval links sent before 2026-05-12 used /approve/<uuid>.
      // Tokens live 7 days; keep this redirect at least through 2026-05-19, but
      // safe to leave permanently.
      {
        source: '/approve/:token',
        destination: '/e/:token',
        permanent: true,
      },
    ]
  },
};

export default nextConfig;
