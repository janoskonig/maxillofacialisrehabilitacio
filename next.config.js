// Bundle analyzer (ANALYZE=true npm run build)
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

// Sentry integration (if enabled)
const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable instrumentation hook (for Sentry)
  // Build memory: webpackBuildWorker (opt-out custom webpacknél, kézzel kényszeríthető), serverSourceMaps off
  experimental: {
    instrumentationHook: true,
    webpackBuildWorker: true,
    serverSourceMaps: false,
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
  
  webpack: (config, { dev }) => {
    // Build memory: cache memória-típusra állítása (Next Memory guide)
    if (config.cache !== false && !dev) {
      config.cache = Object.freeze({ type: 'memory' });
    }
    return config;
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
