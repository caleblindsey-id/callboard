import type { NextConfig } from "next";

const SUPABASE_URL = "https://haohkybnmnpuxpiykjvb.supabase.co";
const SUPABASE_WSS = "wss://haohkybnmnpuxpiykjvb.supabase.co";

// CSP staged in Report-Only first so violations surface in DevTools without
// breaking the app. Once a reporting window shows the policy is clean, flip
// the header key to `Content-Security-Policy` and tighten script-src.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${SUPABASE_URL}`,
  `connect-src 'self' ${SUPABASE_URL} ${SUPABASE_WSS}`,
  "font-src 'self' data:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
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
