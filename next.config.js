/** @type {import('next').NextConfig} */
const nextConfig = {
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

module.exports = nextConfig
