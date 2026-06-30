import type { NextConfig } from "next";

/**
 * Security response headers applied to every route. Defense-in-depth on top of
 * the app's auth + per-user data scoping.
 *
 * Note: a full Content-Security-Policy is intentionally deferred — it needs
 * per-request nonces to avoid breaking Next's inline runtime and Recharts'
 * inline styles, which is a separate hardening pass.
 */
const securityHeaders = [
  // Clickjacking: this app is never meant to be embedded in a frame.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // Stop browsers from MIME-sniffing responses into a different type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full URLs (which can carry filter state) to other origins.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Drop powerful APIs we never use.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Force HTTPS for two years (Vercel serves TLS). Harmless on localhost.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
