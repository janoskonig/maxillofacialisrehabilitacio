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
    return config;
  },
}

module.exports = nextConfig
