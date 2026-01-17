// Sentry integration (if enabled)
const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable instrumentation hook (for Sentry)
  experimental: {
    instrumentationHook: true,
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
  
  // Webpack konfiguráció console.log eltávolításához production-ben
  webpack: (config, { dev, isServer }) => {
    if (!dev && !isServer) {
      // Production build-ben eltávolítjuk a console.log, console.warn, console.info hívásokat
      // console.error meghagyása, mert az fontos lehet debugging-hoz
      config.optimization = {
        ...config.optimization,
        minimize: true,
      };
    }
    
    // Fix pdfkit font files issue
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'pdfkit': require.resolve('pdfkit/js/pdfkit.es.js'),
      };
      
      // Copy pdfkit font files
      config.module.rules.push({
        test: /\.afm$/,
        type: 'asset/resource',
      });
    }
    
    return config;
  },
}

// Wrap with Sentry config only if enabled
if (process.env.ENABLE_SENTRY === 'true') {
  module.exports = withSentryConfig(
    nextConfig,
    {
      // Sentry options
      silent: true, // Suppress source map upload logs
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      // Disable source maps upload for now (can be enabled later)
      widenClientFileUpload: true,
      hideSourceMaps: true,
      // Note: disableLogger is deprecated (removed)
      // Use silent: true instead, and tree-shaking will remove Sentry logger in production builds
    }
  );
} else {
  module.exports = nextConfig;
}
