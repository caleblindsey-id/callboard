import type { NextConfig } from "next";

// Read from env so a dev/preview deployment pointed at a different Supabase
// project is allowed by the CSP connect-src/img-src once it is enforced. Falls
// back to the production project URL when the env var is absent (e.g. local).
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://haohkybnmnpuxpiykjvb.supabase.co";
const SUPABASE_WSS = SUPABASE_URL.replace(/^https/, "wss");

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
  // The /help route reads its markdown from src/content/help at request time.
  // Force those files into the route's serverless bundle so reads don't ENOENT
  // in production (node-file-trace can't follow the dynamic readdir on its own).
  outputFileTracingIncludes: {
    "/help/[[...slug]]": ["./src/content/help/**/*"],
  },
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
