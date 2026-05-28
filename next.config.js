// Bundle analyzer (ANALYZE=true npm run build)
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

// Sentry integration (if enabled)
const { withSentryConfig } = require('@sentry/nextjs');

// Render build VMs (~2 GB RAM) OOM during the post-compile ESLint/TS phase.
// Run lint + typecheck in CI instead; set SKIP_BUILD_CHECKS=true on deploy builds.
const skipBuildChecks = process.env.SKIP_BUILD_CHECKS === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: skipBuildChecks,
  },
  typescript: {
    ignoreBuildErrors: skipBuildChecks,
  },
  // Enable instrumentation hook (for Sentry)
  // Build memory: webpackBuildWorker (opt-out custom webpacknél, kézzel kényszeríthető), serverSourceMaps off
  experimental: {
    instrumentationHook: true,
    // Low-memory build: one worker for static generation + isolated webpack workers.
    cpus: 1,
    webpackBuildWorker: true,
    serverSourceMaps: false,
    enablePrerenderSourceMaps: false,
    optimizePackageImports: ['recharts', 'lucide-react', '@dnd-kit/core', '@dnd-kit/sortable'],
  },
  
  // Production optimalizációk
  compress: true,
  
  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  
  // Production build optimalizációk
  swcMinify: true,
  
  // React strict mode (development-ben)
  reactStrictMode: process.env.NODE_ENV === 'production',
  
  // Powerd by header eltávolítása (security)
  poweredByHeader: false,
  
  // Production build optimalizációk
  productionBrowserSourceMaps: false,

  // Strip console.log/info in production via SWC (keep error & warn)
  compiler: {
    removeConsole: {
      exclude: ['error', 'warn'],
    },
  },
  
  // PWA cache control headers
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { 
            key: "Cache-Control", 
            value: "no-store, no-cache, must-revalidate, proxy-revalidate" 
          }
        ]
      },
      {
        source: "/manifest.json",
        headers: [
          { 
            key: "Cache-Control", 
            value: "no-cache" 
          }
        ]
      }
    ];
  },
  
}

// Wrap with Sentry config only if enabled
const analyzedConfig = withBundleAnalyzer(nextConfig);

if (process.env.ENABLE_SENTRY === 'true') {
  module.exports = withSentryConfig(
    analyzedConfig,
    {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      widenClientFileUpload: true,
      hideSourceMaps: true,
    }
  );
} else {
  module.exports = analyzedConfig;
}
